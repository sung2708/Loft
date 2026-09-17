package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"loft/backend/internal/spotify"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)


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
	clientID, redirect := os.Getenv("SPOTIFY_CLIENT_ID"), os.Getenv("SPOTIFY_REDIRECT_URI")
	if clientID == "" || redirect == "" {
		writeError(w, http.StatusServiceUnavailable, "SPOTIFY_CONFIG", "Spotify is not configured")
		return
	}
	if clientRedirect := r.URL.Query().Get("redirect_uri"); clientRedirect != "" {
		if u, err := url.Parse(clientRedirect); err == nil && u.Path == "/auth/spotify/callback" {
			origin := fmt.Sprintf("%s://%s", u.Scheme, u.Host)
			if _, ok := s.origins[origin]; ok {
				redirect = clientRedirect
			}
		}
	}
	verifier, challenge, err := spotifyVerifier()
	if err != nil {
		s.internal(w, r, "create spotify oauth state", err)
		return
	}
	state := uuid.NewString()
	returnTo := r.URL.Query().Get("return_to")
	if !strings.HasPrefix(returnTo, "/") || strings.HasPrefix(returnTo, "//") || strings.Contains(returnTo, "\\") {
		returnTo = "/settings"
	}
	s.spotifyMu.Lock()
	s.spotifyStates[state] = spotifyOAuthState{UserID: identity.ID, Verifier: verifier, RedirectURI: redirect, ReturnTo: returnTo, ExpiresAt: time.Now().Add(10 * time.Minute)}
	s.spotifyMu.Unlock()
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
	s.logger.Info("spotify connect initiated", "user_id", identity.ID, "redirect_uri", redirect, "return_to", returnTo)
	if r.Header.Get("Accept") == "application/json" {
		writeJSON(w, http.StatusOK, map[string]string{"url": u.String()})
		return
	}
	http.Redirect(w, r, u.String(), http.StatusFound)
}

func (s *Server) spotifyCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	s.spotifyMu.Lock()
	item, ok := s.spotifyStates[state]
	if ok {
		delete(s.spotifyStates, state)
	}
	s.spotifyMu.Unlock()
	frontend := "http://127.0.0.1:3000/auth/spotify/callback"
	if item.RedirectURI != "" {
		if u, err := url.Parse(item.RedirectURI); err == nil {
			frontend = fmt.Sprintf("%s://%s/auth/spotify/callback", u.Scheme, u.Host)
		}
	}
	redirect := func(status string) {
		if strings.Contains(r.Header.Get("Accept"), "application/json") || r.URL.Query().Get("format") == "json" {
			if status == "connected" {
				writeJSON(w, http.StatusOK, map[string]string{
					"status":    status,
					"return_to": item.ReturnTo,
				})
			} else {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"status":    status,
					"return_to": item.ReturnTo,
					"error":     "spotify_auth_failed",
				})
			}
			return
		}
		u, _ := url.Parse(frontend)
		q := u.Query()
		q.Set("status", status)
		q.Set("return_to", item.ReturnTo)
		u.RawQuery = q.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
	}
	if !ok {
		s.logger.Warn("spotify callback state not found or already consumed", "state", state)
		redirect("failed")
		return
	}
	if time.Now().After(item.ExpiresAt) {
		s.logger.Warn("spotify callback state expired", "state", state, "expired_at", item.ExpiresAt)
		redirect("failed")
		return
	}
	if code == "" {
		s.logger.Warn("spotify callback missing code parameter", "state", state)
		redirect("failed")
		return
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {item.RedirectURI}, "client_id": {os.Getenv("SPOTIFY_CLIENT_ID")}, "code_verifier": {item.Verifier}}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, "https://accounts.spotify.com/api/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.logger.Error("spotify token exchange failed network request", "err", err)
		redirect("failed")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		s.logger.Error("spotify token exchange error response", "status_code", resp.StatusCode, "response", string(bodyBytes))
		redirect("failed")
		return
	}
	var token struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil || token.AccessToken == "" {
		s.logger.Error("spotify token exchange invalid response json", "err", err)
		redirect("failed")
		return
	}
	// Persist both tokens encrypted; never put provider credentials in the browser.
	if rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY"); rawKey != "" {
		key, keyErr := spotify.DecodeCredentialKey(rawKey)
		if keyErr != nil {
			s.logger.Error("spotify callback invalid credential key", "err", keyErr)
			redirect("failed")
			return
		}
		accessCipher, keyErr := spotify.EncryptCredential(key, token.AccessToken)
		if keyErr != nil {
			s.logger.Error("spotify callback encryption of access token failed", "err", keyErr)
			redirect("failed")
			return
		}
		refresh := token.RefreshToken
		refreshCipher, keyErr := spotify.EncryptCredential(key, refresh)
		if keyErr != nil {
			s.logger.Error("spotify callback encryption of refresh token failed", "err", keyErr)
			redirect("failed")
			return
		}
		if saver, ok := s.store.(interface {
			SaveSpotifyCredentials(context.Context, spotify.Credentials, string, string) error
		}); ok {
			err = saver.SaveSpotifyCredentials(r.Context(), spotify.Credentials{UserID: item.UserID, AccessToken: token.AccessToken, RefreshToken: refresh, ExpiresAt: time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)}, accessCipher, refreshCipher)
			if err != nil {
				s.logger.Error("spotify callback database save failed", "err", err, "user_id", item.UserID)
				redirect("failed")
				return
			}
		} else {
			s.logger.Error("spotify callback store missing SaveSpotifyCredentials")
			redirect("failed")
			return
		}
	}
	s.spotifyMu.Lock()
	s.spotifyTokens[item.UserID] = token.AccessToken
	s.spotifyRefreshTokens[item.UserID] = token.RefreshToken
	s.spotifyMu.Unlock()
	s.logger.Info("spotify connected successfully", "user_id", item.UserID)
	redirect("connected")
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
	s.spotifyMu.Lock()
	inMemToken := s.spotifyTokens[identity.ID]
	s.spotifyMu.Unlock()
	if inMemToken != "" {
		writeJSON(w, http.StatusOK, map[string]any{"connected": true, "available": true})
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

func (s *Server) persistSpotifyTokens(ctx context.Context, userID, access, refresh string, expiresAt time.Time) {
	rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY")
	if rawKey == "" {
		return
	}
	key, err := spotify.DecodeCredentialKey(rawKey)
	if err != nil {
		s.logger.Error("spotify persist tokens invalid credential key", "err", err)
		return
	}
	accessCipher, err1 := spotify.EncryptCredential(key, access)
	refreshCipher, err2 := spotify.EncryptCredential(key, refresh)
	if err1 != nil || err2 != nil {
		s.logger.Error("spotify persist tokens encryption failed", "err1", err1, "err2", err2)
		return
	}
	if updater, ok := s.store.(interface {
		UpdateSpotifyTokens(context.Context, string, string, string, time.Time) error
	}); ok {
		_ = updater.UpdateSpotifyTokens(ctx, userID, accessCipher, refreshCipher, expiresAt)
	}
}

func (s *Server) revokeSpotifyLocal(ctx context.Context, userID string) {
	s.spotifyMu.Lock()
	delete(s.spotifyTokens, userID)
	delete(s.spotifyRefreshTokens, userID)
	s.spotifyMu.Unlock()
	if revoker, ok := s.store.(interface {
		RevokeSpotifyCredentials(context.Context, string, time.Time) error
	}); ok {
		_ = revoker.RevokeSpotifyCredentials(ctx, userID, time.Now().UTC())
	}
}

func (s *Server) spotifySearch(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" || len([]rune(query)) > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "Enter a track or artist")
		return
	}
	s.spotifyMu.Lock()
	token := s.spotifyTokens[identity.ID]
	refreshToken := s.spotifyRefreshTokens[identity.ID]
	s.spotifyMu.Unlock()
	if token == "" {
		if rawKey := os.Getenv("SPOTIFY_CREDENTIAL_KEY"); rawKey != "" {
			if key, keyErr := spotify.DecodeCredentialKey(rawKey); keyErr == nil {
				if loader, ok := s.store.(interface {
					LoadSpotifyCredentials(context.Context, string) (string, string, []string, time.Time, *time.Time, error)
				}); ok {
					accessCipher, refreshCipher, _, expiresAt, revokedAt, loadErr := loader.LoadSpotifyCredentials(r.Context(), identity.ID)
					if loadErr == nil && revokedAt == nil {
						if access, decErr := spotify.DecryptCredential(key, accessCipher); decErr == nil {
							token = access
						}
						if refresh, decErr := spotify.DecryptCredential(key, refreshCipher); decErr == nil {
							refreshToken = refresh
						}
						if time.Now().After(expiresAt) {
							token = ""
						}
					}
				}
			}
		}
	}
	if token == "" {
		if refreshToken != "" {
			refreshed, refreshErr := (spotify.TokenRefresher{ClientID: os.Getenv("SPOTIFY_CLIENT_ID")}).Refresh(r.Context(), refreshToken)
			if refreshErr == nil {
				token, refreshToken = refreshed.AccessToken, refreshed.RefreshToken
				s.spotifyMu.Lock()
				s.spotifyTokens[identity.ID] = token
				s.spotifyRefreshTokens[identity.ID] = refreshToken
				s.spotifyMu.Unlock()
				s.persistSpotifyTokens(r.Context(), identity.ID, token, refreshToken, refreshed.ExpiresAt)
			} else {
				s.revokeSpotifyLocal(r.Context(), identity.ID)
				writeError(w, http.StatusUnauthorized, "SPOTIFY_REAUTH_REQUIRED", "Reconnect Spotify")
				return
			}
		}
	}
	if token == "" {
		writeError(w, http.StatusUnauthorized, "SPOTIFY_NOT_CONNECTED", "Connect Spotify first")
		return
	}
	u := "https://api.spotify.com/v1/search?type=track&limit=10&q=" + url.QueryEscape(query)
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		if refreshToken != "" {
			_ = resp.Body.Close()
			refreshed, refreshErr := (spotify.TokenRefresher{ClientID: os.Getenv("SPOTIFY_CLIENT_ID")}).Refresh(r.Context(), refreshToken)
			if refreshErr == nil {
				token, refreshToken = refreshed.AccessToken, refreshed.RefreshToken
				s.spotifyMu.Lock()
				s.spotifyTokens[identity.ID] = token
				s.spotifyRefreshTokens[identity.ID] = refreshToken
				s.spotifyMu.Unlock()
				s.persistSpotifyTokens(r.Context(), identity.ID, token, refreshToken, refreshed.ExpiresAt)
				retryReq, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, u, nil)
				retryReq.Header.Set("Authorization", "Bearer "+token)
				retryResp, retryErr := http.DefaultClient.Do(retryReq)
				if retryErr == nil {
					resp = retryResp
				} else {
					writeError(w, http.StatusBadGateway, "SPOTIFY_UNAVAILABLE", "Spotify search is unavailable")
					return
				}
			} else {
				s.revokeSpotifyLocal(r.Context(), identity.ID)
				writeError(w, http.StatusUnauthorized, "SPOTIFY_REAUTH_REQUIRED", "Reconnect Spotify")
				return
			}
		} else {
			s.revokeSpotifyLocal(r.Context(), identity.ID)
			writeError(w, http.StatusUnauthorized, "SPOTIFY_REAUTH_REQUIRED", "Reconnect Spotify")
			return
		}
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
		URI, Name string
		Artists   []string
		ImageURL  string `json:"image_url,omitempty"`
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
	s.spotifyMu.Lock()
	delete(s.spotifyTokens, identity.ID)
	delete(s.spotifyRefreshTokens, identity.ID)
	s.spotifyMu.Unlock()
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
		if err := revoker.RevokeSpotifyCredentials(r.Context(), identity.ID, time.Now()); err != nil {
			s.internal(w, r, "revoke spotify", err)
			return
		}
	}
	s.spotifyMu.Lock()
	delete(s.spotifyTokens, identity.ID)
	delete(s.spotifyRefreshTokens, identity.ID)
	s.spotifyMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
