package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"loft/backend/internal/domain"
	"loft/backend/internal/spotify"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

const spotifyOAuthStateTTL = 10 * time.Minute

func spotifyStateKey(state string) string { return "oauth:spotify:state:" + state }

func (s *Server) getUserOAuthEpoch(ctx context.Context, userID string) (int64, error) {
	s.spotifyMu.Lock()
	store := s.spotifyStateStore
	s.spotifyMu.Unlock()
	if store != nil {
		return store.GetUserOAuthEpoch(ctx, userID)
	}
	s.spotifyMu.Lock()
	defer s.spotifyMu.Unlock()
	return s.spotifyUserEpochs[userID], nil
}

func (s *Server) bumpUserOAuthEpoch(ctx context.Context, userID string) (int64, error) {
	s.spotifyMu.Lock()
	store := s.spotifyStateStore
	s.spotifyMu.Unlock()
	if store != nil {
		return store.BumpUserOAuthEpoch(ctx, userID)
	}
	s.spotifyMu.Lock()
	defer s.spotifyMu.Unlock()
	s.spotifyUserEpochs[userID]++
	return s.spotifyUserEpochs[userID], nil
}

func spotifyVerifier() (string, string, error) {
	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	v := base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(v))
	return v, base64.RawURLEncoding.EncodeToString(h[:]), nil
}

func (s *Server) spotifyConnect(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("SPOTIFY_ENABLED") != "true" {
		writeError(w, http.StatusNotFound, "SPOTIFY_DISABLED", "Spotify is unavailable")
		return
	}
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if !s.spotifyConnectLimit.AllowContext(r.Context(), identity.ID) {
		writeError(w, http.StatusTooManyRequests, "SPOTIFY_RATE_LIMITED", "Try connecting Spotify again shortly")
		return
	}
	if err := s.store.UpsertProfile(r.Context(), identity); err != nil {
		s.internal(w, r, "upsert Spotify profile", err)
		return
	}
	clientID, redirect := os.Getenv("SPOTIFY_CLIENT_ID"), os.Getenv("SPOTIFY_REDIRECT_URI")
	if clientID == "" || redirect == "" {
		writeError(w, http.StatusServiceUnavailable, "SPOTIFY_CONFIG", "Spotify is not configured")
		return
	}
	verifier, challenge, err := spotifyVerifier()
	if err != nil {
		s.internal(w, r, "create spotify oauth state", err)
		return
	}
	epoch, err := s.getUserOAuthEpoch(r.Context(), identity.ID)
	if err != nil {
		s.logger.Error("get user oauth epoch failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "SPOTIFY_UNAVAILABLE", "Spotify is temporarily unavailable")
		return
	}
	state := uuid.NewString()
	item := spotifyOAuthState{UserID: identity.ID, Verifier: verifier, ExpiresAt: time.Now().Add(spotifyOAuthStateTTL), Epoch: epoch}
	if err := s.storeSpotifyState(r.Context(), state, item); err != nil {
		s.logger.Error("spotify OAuth state storage failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "SPOTIFY_UNAVAILABLE", "Spotify is temporarily unavailable")
		return
	}
	u, _ := url.Parse("https://accounts.spotify.com/authorize")
	q := u.Query()
	q.Set("client_id", clientID)
	q.Set("response_type", "code")
	q.Set("redirect_uri", redirect)
	q.Set("code_challenge_method", "S256")
	q.Set("code_challenge", challenge)
	q.Set("state", state)
	q.Set("scope", "user-read-private user-read-email streaming user-read-playback-state user-modify-playback-state")
	u.RawQuery = q.Encode()
	s.logger.Info("spotify connect initiated", "user_id", identity.ID, "redirect_uri", redirect)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Header.Get("Accept") == "application/json" {
		writeJSON(w, http.StatusOK, map[string]string{"url": u.String()})
		return
	}
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func (s *Server) spotifyCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	item, ok, stateErr := s.consumeSpotifyState(r.Context(), state)
	if stateErr != nil {
		s.logger.Error("spotify OAuth state consume failed", "error", stateErr)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_unavailable")
		return
	}
	if !ok {
		s.logger.Warn("spotify callback state not found or already consumed")
		s.redirectSpotifyCallback(w, r, "failed", "oauth_expired")
		return
	}
	if time.Now().After(item.ExpiresAt) {
		s.logger.Warn("spotify callback state expired")
		s.redirectSpotifyCallback(w, r, "failed", "oauth_expired")
		return
	}
	// Verify epoch to prevent stale/delayed OAuth callbacks from reconnecting after disconnect/revoke
	currentEpoch, epochErr := s.getUserOAuthEpoch(r.Context(), item.UserID)
	if epochErr == nil && item.Epoch != currentEpoch {
		s.logger.Warn("spotify callback rejected due to epoch mismatch (user disconnected/revoked while oauth was pending)", "user_id", item.UserID, "state_epoch", item.Epoch, "current_epoch", currentEpoch)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_revoked")
		return
	}
	if r.URL.Query().Get("error") != "" {
		s.logger.Info("spotify authorization declined", "reason", r.URL.Query().Get("error"))
		s.redirectSpotifyCallback(w, r, "failed", "oauth_denied")
		return
	}
	if code == "" {
		s.logger.Warn("spotify callback missing code parameter")
		s.redirectSpotifyCallback(w, r, "failed", "oauth_invalid")
		return
	}
	redirectURI := os.Getenv("SPOTIFY_REDIRECT_URI")
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirectURI}, "client_id": {os.Getenv("SPOTIFY_CLIENT_ID")}, "code_verifier": {item.Verifier}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	if err != nil {
		s.logger.Error("spotify token exchange request creation failed", "error", err)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_unavailable")
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		s.logger.Error("spotify token exchange failed network request", "err", err)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
		s.logger.Error("spotify token exchange error response", "status_code", resp.StatusCode)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_invalid")
		return
	}
	var token struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil || token.AccessToken == "" || token.RefreshToken == "" {
		s.logger.Error("spotify token exchange invalid response json", "err", err)
		s.redirectSpotifyCallback(w, r, "failed", "oauth_unavailable")
		return
	}
	// Persist both tokens encrypted; never put provider credentials in the browser.
	rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY")
	key, keyErr := spotify.DecodeCredentialKey(rawKey)
	if rawKey == "" || keyErr != nil {
		s.logger.Error("spotify callback invalid credential key", "err", keyErr)
		s.redirectSpotifyCallback(w, r, "failed", "credential_store_failed")
		return
	}
	accessCipher, keyErr := spotify.EncryptCredential(key, token.AccessToken)
	if keyErr != nil {
		s.logger.Error("spotify callback encryption of access token failed", "err", keyErr)
		s.redirectSpotifyCallback(w, r, "failed", "credential_store_failed")
		return
	}
	refreshCipher, keyErr := spotify.EncryptCredential(key, token.RefreshToken)
	if keyErr != nil {
		s.logger.Error("spotify callback encryption of refresh token failed", "err", keyErr)
		s.redirectSpotifyCallback(w, r, "failed", "credential_store_failed")
		return
	}
	saver, ok := s.store.(interface {
		SaveSpotifyCredentials(context.Context, spotify.Credentials, string, string) error
	})
	if !ok {
		s.logger.Error("spotify callback store missing SaveSpotifyCredentials")
		s.redirectSpotifyCallback(w, r, "failed", "credential_store_failed")
		return
	}
	credentials := spotify.Credentials{
		UserID:       item.UserID,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		Scopes:       strings.Fields(token.Scope),
		ExpiresAt:    time.Now().Add(time.Duration(token.ExpiresIn) * time.Second),
	}
	if err = saver.SaveSpotifyCredentials(r.Context(), credentials, accessCipher, refreshCipher); err != nil {
		s.logger.Error("spotify callback database save failed", "err", err, "user_id", item.UserID)
		s.redirectSpotifyCallback(w, r, "failed", "credential_store_failed")
		return
	}
	s.logger.Info("spotify connected successfully", "user_id", item.UserID)
	s.redirectSpotifyCallback(w, r, "connected", "")
}

func (s *Server) storeSpotifyState(ctx context.Context, state string, item spotifyOAuthState) error {
	s.spotifyMu.Lock()
	store := s.spotifyStateStore
	s.spotifyMu.Unlock()
	if store != nil {
		payload, err := json.Marshal(item)
		if err != nil {
			return err
		}
		return store.PutOAuthState(ctx, spotifyStateKey(state), payload, spotifyOAuthStateTTL)
	}

	s.spotifyMu.Lock()
	defer s.spotifyMu.Unlock()
	now := time.Now()
	for key, candidate := range s.spotifyStates {
		if !candidate.ExpiresAt.After(now) {
			delete(s.spotifyStates, key)
		}
	}
	if len(s.spotifyStates) >= spotifyStateCapacity {
		return fmt.Errorf("local Spotify OAuth state capacity reached")
	}
	s.spotifyStates[state] = item
	return nil
}

func (s *Server) consumeSpotifyState(ctx context.Context, state string) (spotifyOAuthState, bool, error) {
	if state == "" {
		return spotifyOAuthState{}, false, nil
	}
	s.spotifyMu.Lock()
	store := s.spotifyStateStore
	s.spotifyMu.Unlock()
	if store != nil {
		payload, found, err := store.ConsumeOAuthState(ctx, spotifyStateKey(state))
		if err != nil || !found {
			return spotifyOAuthState{}, found, err
		}
		var item spotifyOAuthState
		if err := json.Unmarshal(payload, &item); err != nil || item.UserID == "" || item.Verifier == "" {
			return spotifyOAuthState{}, false, fmt.Errorf("invalid stored Spotify OAuth state")
		}
		return item, true, nil
	}

	s.spotifyMu.Lock()
	item, found := s.spotifyStates[state]
	if found {
		delete(s.spotifyStates, state)
	}
	s.spotifyMu.Unlock()
	return item, found, nil
}

func (s *Server) redirectSpotifyCallback(w http.ResponseWriter, r *http.Request, status, reason string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if strings.Contains(r.Header.Get("Accept"), "application/json") || r.URL.Query().Get("format") == "json" {
		if status == "connected" {
			writeJSON(w, http.StatusOK, map[string]string{"status": status})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"status": status, "error": reason})
		return
	}
	s.spotifyMu.Lock()
	origin := s.frontendOrigin
	s.spotifyMu.Unlock()
	frontend := strings.TrimRight(origin, "/") + "/auth/spotify/callback"
	u, err := url.Parse(frontend)
	if err != nil || u.Scheme == "" || u.Host == "" {
		http.Error(w, "Spotify callback is unavailable", http.StatusServiceUnavailable)
		return
	}
	q := u.Query()
	q.Set("status", status)
	if reason != "" {
		q.Set("reason", reason)
	}
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}

type decryptedSpotifyCredentials struct {
	UserID           string
	AccessToken      string
	RefreshToken     string
	RawRefreshCipher string
	Scopes           []string
	ExpiresAt        time.Time
}

func (s *Server) loadDecryptedSpotifyCredentials(ctx context.Context, userID string) (*decryptedSpotifyCredentials, error) {
	loader, ok := s.store.(interface {
		LoadSpotifyCredentials(context.Context, string) (string, string, []string, time.Time, *time.Time, error)
	})
	if !ok {
		return nil, fmt.Errorf("spotify store does not support LoadSpotifyCredentials")
	}
	accessCipher, refreshCipher, scopes, expiresAt, revokedAt, err := loader.LoadSpotifyCredentials(ctx, userID)
	if err != nil {
		return nil, err
	}
	if revokedAt != nil || refreshCipher == "" {
		return nil, domain.ErrNotFound
	}
	rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY")
	if rawKey == "" {
		return nil, fmt.Errorf("SPOTIFY_CREDENTIAL_KEY is not configured")
	}
	key, keyErr := spotify.DecodeCredentialKey(rawKey)
	if keyErr != nil {
		return nil, fmt.Errorf("decode spotify credential key: %w", keyErr)
	}
	accessToken := ""
	if accessCipher != "" {
		decrypted, decErr := spotify.DecryptCredential(key, accessCipher)
		if decErr != nil {
			return nil, fmt.Errorf("decrypt access token: %w", decErr)
		}
		accessToken = decrypted
	}
	refreshToken, decErr := spotify.DecryptCredential(key, refreshCipher)
	if decErr != nil {
		return nil, fmt.Errorf("decrypt refresh token: %w", decErr)
	}
	return &decryptedSpotifyCredentials{
		UserID:           userID,
		AccessToken:      accessToken,
		RefreshToken:     refreshToken,
		RawRefreshCipher: refreshCipher,
		Scopes:           scopes,
		ExpiresAt:        expiresAt,
	}, nil
}

func (s *Server) getOrRefreshSpotifyToken(ctx context.Context, userID string) (string, error) {
	creds, err := s.loadDecryptedSpotifyCredentials(ctx, userID)
	if err != nil {
		return "", err
	}
	now := time.Now()
	// Proactive refresh: if token expires within 2 minutes or is already expired, refresh it
	if creds.AccessToken != "" && creds.ExpiresAt.After(now.Add(2*time.Minute)) {
		return creds.AccessToken, nil
	}
	return s.refreshAndPersistSpotifyToken(ctx, creds)
}

func (s *Server) refreshAndPersistSpotifyToken(ctx context.Context, creds *decryptedSpotifyCredentials) (string, error) {
	clientID := os.Getenv("SPOTIFY_CLIENT_ID")
	if clientID == "" {
		return "", fmt.Errorf("SPOTIFY_CLIENT_ID is not configured")
	}
	client := &http.Client{Timeout: 8 * time.Second}
	refresher := spotify.TokenRefresher{ClientID: clientID, HTTP: client}
	refreshed, err := refresher.Refresh(ctx, creds.RefreshToken)
	if err != nil {
		if errors.Is(err, spotify.ErrInvalidGrant) {
			s.logger.Warn("spotify refresh failed with invalid_grant; revoking credentials", "user_id", creds.UserID)
			if revoker, ok := s.store.(interface {
				RevokeSpotifyCredentialsIfCurrent(context.Context, string, string, time.Time) (bool, error)
			}); ok {
				_, _ = revoker.RevokeSpotifyCredentialsIfCurrent(ctx, creds.UserID, creds.RawRefreshCipher, time.Now().UTC())
			}
			_, _ = s.bumpUserOAuthEpoch(ctx, creds.UserID)
			return "", spotify.ErrInvalidGrant
		}
		// Transient network, timeout, 429, or 5xx: DO NOT revoke!
		s.logger.Error("spotify refresh transient error", "user_id", creds.UserID, "error", err)
		return "", err
	}
	rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY")
	key, keyErr := spotify.DecodeCredentialKey(rawKey)
	if keyErr != nil {
		return "", fmt.Errorf("decode credential key: %w", keyErr)
	}
	newAccessCipher, err := spotify.EncryptCredential(key, refreshed.AccessToken)
	if err != nil {
		return "", fmt.Errorf("encrypt access token: %w", err)
	}
	newRefreshCipher, err := spotify.EncryptCredential(key, refreshed.RefreshToken)
	if err != nil {
		return "", fmt.Errorf("encrypt refresh token: %w", err)
	}
	replacer, ok := s.store.(interface {
		ReplaceSpotifyTokensIfCurrent(context.Context, string, string, string, string, time.Time) (bool, error)
	})
	if !ok {
		return "", fmt.Errorf("store does not support ReplaceSpotifyTokensIfCurrent")
	}
	casSuccess, casErr := replacer.ReplaceSpotifyTokensIfCurrent(ctx, creds.UserID, creds.RawRefreshCipher, newAccessCipher, newRefreshCipher, refreshed.ExpiresAt)
	if casErr != nil {
		return "", fmt.Errorf("CAS replace spotify tokens: %w", casErr)
	}
	if !casSuccess {
		// CAS conflict: another instance refreshed the token concurrently.
		// Reload the winner credentials from DB; never overwrite another instance's credential.
		s.logger.Info("spotify CAS conflict during token refresh; reloading winner credentials", "user_id", creds.UserID)
		winnerCreds, loadErr := s.loadDecryptedSpotifyCredentials(ctx, creds.UserID)
		if loadErr == nil && winnerCreds.AccessToken != "" {
			return winnerCreds.AccessToken, nil
		}
	}
	return refreshed.AccessToken, nil
}

func (s *Server) spotifyStatus(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("SPOTIFY_ENABLED") != "true" {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "available": false})
		return
	}
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if loader, ok := s.store.(interface {
		LoadSpotifyCredentials(context.Context, string) (string, string, []string, time.Time, *time.Time, error)
	}); ok {
		_, refreshCipher, scopes, _, revokedAt, loadErr := loader.LoadSpotifyCredentials(r.Context(), identity.ID)
		if loadErr == nil && revokedAt == nil && refreshCipher != "" {
			writeJSON(w, http.StatusOK, map[string]any{"connected": true, "available": true, "scopes": scopes})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": false, "available": true})
}

func (s *Server) spotifySearch(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("SPOTIFY_ENABLED") != "true" {
		writeError(w, http.StatusNotFound, "SPOTIFY_DISABLED", "Spotify is unavailable")
		return
	}
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if !s.spotifySearchLimit.AllowContext(r.Context(), identity.ID) {
		writeError(w, http.StatusTooManyRequests, "SPOTIFY_RATE_LIMITED", "Try searching Spotify again shortly")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" || len([]rune(query)) > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "Enter a track or artist")
		return
	}

	token, err := s.getOrRefreshSpotifyToken(r.Context(), identity.ID)
	if err != nil {
		if errors.Is(err, spotify.ErrInvalidGrant) {
			writeError(w, http.StatusUnauthorized, "SPOTIFY_REAUTH_REQUIRED", "Reconnect Spotify")
			return
		}
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "SPOTIFY_NOT_CONNECTED", "Connect Spotify first")
			return
		}
		writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is temporarily unavailable")
		return
	}

	u := "https://api.spotify.com/v1/search?type=track&limit=10&q=" + url.QueryEscape(query)
	httpClient := &http.Client{Timeout: 8 * time.Second}
	req, reqErr := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	if reqErr != nil {
		s.internal(w, r, "create search request", reqErr)
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		// Access token may have been revoked on Spotify's side. Force refresh.
		creds, loadErr := s.loadDecryptedSpotifyCredentials(r.Context(), identity.ID)
		if loadErr != nil {
			writeError(w, http.StatusUnauthorized, "SPOTIFY_NOT_CONNECTED", "Connect Spotify first")
			return
		}
		newToken, refreshErr := s.refreshAndPersistSpotifyToken(r.Context(), creds)
		if refreshErr != nil {
			if errors.Is(refreshErr, spotify.ErrInvalidGrant) {
				writeError(w, http.StatusUnauthorized, "SPOTIFY_REAUTH_REQUIRED", "Reconnect Spotify")
				return
			}
			writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is unavailable")
			return
		}
		retryReq, retryReqErr := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
		if retryReqErr != nil {
			s.internal(w, r, "create retry search request", retryReqErr)
			return
		}
		retryReq.Header.Set("Authorization", "Bearer "+newToken)
		retryResp, retryErr := httpClient.Do(retryReq)
		if retryErr != nil {
			writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is unavailable")
			return
		}
		defer retryResp.Body.Close()
		resp = retryResp
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		writeError(w, http.StatusTooManyRequests, "SPOTIFY_RATE_LIMITED", "Spotify rate limit reached; retry shortly")
		return
	}
	if resp.StatusCode == http.StatusForbidden {
		writeError(w, http.StatusForbidden, "SPOTIFY_FORBIDDEN", "Spotify catalog access denied")
		return
	}
	if resp.StatusCode >= 400 {
		writeError(w, http.StatusBadGateway, "SPOTIFY_SEARCH_FAILED", "Spotify search failed")
		return
	}
	var payload struct {
		Tracks struct {
			Items []struct {
				URI, Name string
				Artists   []struct {
					Name string `json:"name"`
				} `json:"artists"`
				Album struct {
					Images []struct {
						URL string `json:"url"`
					} `json:"images"`
				} `json:"album"`
			} `json:"items"`
		} `json:"tracks"`
	}
	if json.NewDecoder(resp.Body).Decode(&payload) != nil {
		writeError(w, http.StatusBadGateway, "SPOTIFY_SEARCH_FAILED", "Invalid Spotify response")
		return
	}
	type result struct {
		URI      string   `json:"uri"`
		Name     string   `json:"name"`
		Artists  []string `json:"artists"`
		ImageURL string   `json:"image_url,omitempty"`
	}
	results := make([]result, 0, len(payload.Tracks.Items))
	for _, item := range payload.Tracks.Items {
		artists := make([]string, 0, len(item.Artists))
		for _, artist := range item.Artists {
			artists = append(artists, artist.Name)
		}
		image := ""
		if len(item.Album.Images) > 0 {
			image = item.Album.Images[0].URL
		}
		results = append(results, result{URI: item.URI, Name: item.Name, Artists: artists, ImageURL: image})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": results})
}

func (s *Server) spotifyDisconnect(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if remover, ok := s.store.(interface {
		DisconnectSpotify(context.Context, string) error
	}); ok {
		if err := remover.DisconnectSpotify(r.Context(), identity.ID); err != nil {
			s.internal(w, r, "disconnect spotify", err)
			return
		}
	}
	_, _ = s.bumpUserOAuthEpoch(r.Context(), identity.ID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

func (s *Server) spotifyRevoke(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if revoker, ok := s.store.(interface {
		RevokeSpotifyCredentials(context.Context, string, time.Time) error
	}); ok {
		if err := revoker.RevokeSpotifyCredentials(r.Context(), identity.ID, time.Now().UTC()); err != nil {
			s.internal(w, r, "revoke spotify", err)
			return
		}
	}
	_, _ = s.bumpUserOAuthEpoch(r.Context(), identity.ID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
