package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/spotify"
)

type spotifyMockStore struct {
	*fakeStore
	mu            sync.Mutex
	accessCipher  string
	refreshCipher string
	scopes        []string
	expiresAt     time.Time
	revokedAt     *time.Time
	hasRecord     bool
	casFailures   int
	saveError     error
	replaceError  error
	revokedCalled bool
}

func (s *spotifyMockStore) LoadSpotifyCredentials(_ context.Context, _ string) (string, string, []string, time.Time, *time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasRecord {
		return "", "", nil, time.Time{}, nil, domain.ErrNotFound
	}
	return s.accessCipher, s.refreshCipher, s.scopes, s.expiresAt, s.revokedAt, nil
}

func (s *spotifyMockStore) SaveSpotifyCredentials(_ context.Context, c spotify.Credentials, accessCipher, refreshCipher string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveError != nil {
		return s.saveError
	}
	s.hasRecord = true
	s.accessCipher = accessCipher
	s.refreshCipher = refreshCipher
	s.scopes = c.Scopes
	s.expiresAt = c.ExpiresAt
	s.revokedAt = nil
	return nil
}

func (s *spotifyMockStore) ReplaceSpotifyTokensIfCurrent(_ context.Context, _ string, expectedRefresh, access, refresh string, expiresAt time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.replaceError != nil {
		return false, s.replaceError
	}
	if !s.hasRecord || s.revokedAt != nil {
		return false, nil
	}
	if s.refreshCipher != expectedRefresh {
		return false, nil
	}
	s.accessCipher = access
	s.refreshCipher = refresh
	s.expiresAt = expiresAt
	return true, nil
}

func (s *spotifyMockStore) RevokeSpotifyCredentialsIfCurrent(_ context.Context, _ string, expectedRefresh string, at time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revokedCalled = true
	if !s.hasRecord || s.revokedAt != nil {
		return false, nil
	}
	if s.refreshCipher != expectedRefresh {
		return false, nil
	}
	s.revokedAt = &at
	return true, nil
}

func (s *spotifyMockStore) RevokeSpotifyCredentials(_ context.Context, _ string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revokedCalled = true
	if s.hasRecord {
		s.revokedAt = &at
	}
	return nil
}

func (s *spotifyMockStore) DisconnectSpotify(_ context.Context, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hasRecord = false
	s.accessCipher = ""
	s.refreshCipher = ""
	s.revokedAt = nil
	return nil
}

func setupSpotifyTestEnv(t *testing.T) (string, string, *auth.SupabaseVerifier, string) {
	t.Helper()
	t.Setenv("SPOTIFY_ENABLED", "true")
	t.Setenv("SPOTIFY_CLIENT_ID", "test_client_id")
	t.Setenv("SPOTIFY_REDIRECT_URI", "https://api.mingly.site/api/v1/spotify/callback")
	key := "/iJc1EhvJLCdGt2wGJm6r1SIDjFcyScuh1aft0FHUxo="
	t.Setenv("SPOTIFY_CREDENTIAL_KEY", key)

	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	userID := "b78b0f4d-2a1d-4eb8-b99f-7a544b6c369e"
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":  "https://example.supabase.co/auth/v1",
		"sub":  userID,
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	return userID, token, users, key
}

func TestSpotifyStaleInstanceAfterRevokeDisconnect(t *testing.T) {
	userID, token, users, credKeyRaw := setupSpotifyTestEnv(t)
	credKey, _ := spotify.DecodeCredentialKey(credKeyRaw)
	encAccess, _ := spotify.EncryptCredential(credKey, "access_1")
	encRefresh, _ := spotify.EncryptCredential(credKey, "refresh_1")

	store := &spotifyMockStore{
		fakeStore:     &fakeStore{},
		hasRecord:     true,
		accessCipher:  encAccess,
		refreshCipher: encRefresh,
		scopes:        []string{"streaming"},
		expiresAt:     time.Now().Add(time.Hour),
	}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), livekit.New("key", "secret"), []string{"https://mingly.site"}, nil)
	handler := server.Routes(nil)

	// Disconnect user
	disReq := httptest.NewRequest(http.MethodPost, "/api/v1/spotify/disconnect", nil)
	disReq.Header.Set("Authorization", "Bearer "+token)
	disRec := httptest.NewRecorder()
	handler.ServeHTTP(disRec, disReq)
	if disRec.Code != http.StatusOK {
		t.Fatalf("expected 200 disconnect, got %d", disRec.Code)
	}

	// Status must immediately report connected=false directly from DB
	stReq := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/status", nil)
	stReq.Header.Set("Authorization", "Bearer "+token)
	stRec := httptest.NewRecorder()
	handler.ServeHTTP(stRec, stReq)
	var stRes map[string]any
	_ = json.NewDecoder(stRec.Body).Decode(&stRes)
	if stRes["connected"] != false {
		t.Fatalf("expected connected=false after disconnect, got %v", stRes)
	}

	// Search must immediately return 401 SPOTIFY_NOT_CONNECTED
	searchReq := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/search?q=hello", nil)
	searchReq.Header.Set("Authorization", "Bearer "+token)
	searchRec := httptest.NewRecorder()
	handler.ServeHTTP(searchRec, searchReq)
	if searchRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", searchRec.Code)
	}
	var errRes struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(searchRec.Body).Decode(&errRes)
	if errRes.Error.Code != "SPOTIFY_NOT_CONNECTED" {
		t.Fatalf("expected SPOTIFY_NOT_CONNECTED, got %s", errRes.Error.Code)
	}
	_ = userID
}

func TestSpotifyCASConflictWinnerReload(t *testing.T) {
	_, token, users, credKeyRaw := setupSpotifyTestEnv(t)
	credKey, _ := spotify.DecodeCredentialKey(credKeyRaw)
	encAccessInit, _ := spotify.EncryptCredential(credKey, "access_expired")
	encRefreshOld, _ := spotify.EncryptCredential(credKey, "refresh_old")

	store := &spotifyMockStore{
		fakeStore:     &fakeStore{},
		hasRecord:     true,
		accessCipher:  encAccessInit,
		refreshCipher: encRefreshOld,
		scopes:        []string{"streaming"},
		expiresAt:     time.Now().Add(-time.Minute), // expired, needs refresh
	}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), livekit.New("key", "secret"), []string{"https://mingly.site"}, nil)
	handler := server.Routes(nil)

	// Simulate winner tokens in DB
	encAccessWinner, _ := spotify.EncryptCredential(credKey, "access_winner")
	encRefreshWinner, _ := spotify.EncryptCredential(credKey, "refresh_winner")

	origTransport := http.DefaultTransport
	defer func() { http.DefaultTransport = origTransport }()
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "accounts.spotify.com" && req.URL.Path == "/api/token" {
			// In the background, simulate that another instance won the CAS race before this instance saves
			store.mu.Lock()
			store.accessCipher = encAccessWinner
			store.refreshCipher = encRefreshWinner
			store.expiresAt = time.Now().Add(time.Hour)
			store.mu.Unlock()

			// Return loser's refresh attempt
			respBody := `{"access_token":"access_loser","refresh_token":"refresh_loser","expires_in":3600}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(respBody)),
				Header:     make(http.Header),
			}, nil
		}
		if req.URL.Host == "api.spotify.com" && strings.HasPrefix(req.URL.Path, "/v1/search") {
			// Verify that the search request used the WINNER token, not the loser token
			authHeader := req.Header.Get("Authorization")
			if authHeader != "Bearer access_winner" {
				return &http.Response{
					StatusCode: http.StatusForbidden,
					Body:       io.NopCloser(strings.NewReader(fmt.Sprintf(`{"error":"wrong token: %s"}`, authHeader))),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"tracks":{"items":[{"uri":"spotify:track:1","name":"Song","artists":[{"name":"Artist"}]}]}}`)),
				Header:     make(http.Header),
			}, nil
		}
		return origTransport.RoundTrip(req)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/search?q=song", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 from winner reload, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSpotifyRefreshInvalidGrantVs5xx(t *testing.T) {
	_, token, users, credKeyRaw := setupSpotifyTestEnv(t)
	credKey, _ := spotify.DecodeCredentialKey(credKeyRaw)
	encAccess, _ := spotify.EncryptCredential(credKey, "access_expired")
	encRefresh, _ := spotify.EncryptCredential(credKey, "refresh_1")

	// 1. Test 5xx error: should NOT revoke connection
	store := &spotifyMockStore{
		fakeStore:     &fakeStore{},
		hasRecord:     true,
		accessCipher:  encAccess,
		refreshCipher: encRefresh,
		expiresAt:     time.Now().Add(-time.Minute),
	}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), livekit.New("key", "secret"), []string{"https://mingly.site"}, nil)
	handler := server.Routes(nil)

	origTransport := http.DefaultTransport
	defer func() { http.DefaultTransport = origTransport }()

	var responseStatus int
	var responseBody string
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "accounts.spotify.com" && req.URL.Path == "/api/token" {
			return &http.Response{
				StatusCode: responseStatus,
				Body:       io.NopCloser(strings.NewReader(responseBody)),
				Header:     make(http.Header),
			}, nil
		}
		return origTransport.RoundTrip(req)
	})

	// 500 error from Spotify token endpoint
	responseStatus = http.StatusInternalServerError
	responseBody = `{"error":"server_error","error_description":"Spotify downstream 500"}`
	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/search?q=test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 Bad Gateway for 500 upstream, got %d", rec.Code)
	}
	if store.revokedAt != nil || store.revokedCalled {
		t.Fatalf("connection was falsely revoked on 500 error")
	}

	// 2. Test invalid_grant error: MUST revoke connection
	responseStatus = http.StatusBadRequest
	responseBody = `{"error":"invalid_grant","error_description":"Refresh token revoked"}`
	req = httptest.NewRequest(http.MethodGet, "/api/v1/spotify/search?q=test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid_grant, got %d", rec.Code)
	}
	var errPayload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&errPayload)
	if errPayload.Error.Code != "SPOTIFY_REAUTH_REQUIRED" {
		t.Fatalf("expected SPOTIFY_REAUTH_REQUIRED, got %s", errPayload.Error.Code)
	}
	if store.revokedAt == nil || !store.revokedCalled {
		t.Fatalf("expected connection to be revoked on invalid_grant")
	}
}

func TestSpotifyDelayedOAuthCallbackAfterRevoke(t *testing.T) {
	userID, token, users, _ := setupSpotifyTestEnv(t)
	store := &spotifyMockStore{fakeStore: &fakeStore{}}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), livekit.New("key", "secret"), []string{"https://mingly.site"}, nil)
	handler := server.Routes(nil)

	// Step 1: User starts connect flow
	origTransport := http.DefaultTransport
	defer func() { http.DefaultTransport = origTransport }()
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "accounts.spotify.com" && req.URL.Path == "/api/token" {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"access_token":"acc","refresh_token":"ref","expires_in":3600}`)),
				Header:     make(http.Header),
			}, nil
		}
		return origTransport.RoundTrip(req)
	})

	stateID := "delayed_state_123"
	epoch, _ := server.getUserOAuthEpoch(context.Background(), userID)
	server.spotifyMu.Lock()
	server.spotifyStates[stateID] = spotifyOAuthState{
		UserID:    userID,
		Verifier:  "verifier_abc",
		ExpiresAt: time.Now().Add(10 * time.Minute),
		Epoch:     epoch,
	}
	server.spotifyMu.Unlock()

	// Step 2: User revokes / disconnects while authorization was in flight
	disReq := httptest.NewRequest(http.MethodPost, "/api/v1/spotify/revoke", nil)
	disReq.Header.Set("Authorization", "Bearer "+token)
	disRec := httptest.NewRecorder()
	handler.ServeHTTP(disRec, disReq)
	if disRec.Code != http.StatusOK {
		t.Fatalf("expected 200 revoke, got %d", disRec.Code)
	}

	// Step 3: Delayed callback arrives with the old stateID
	cbReq := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/callback?state="+stateID+"&code=auth_code_123", nil)
	cbRec := httptest.NewRecorder()
	handler.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusSeeOther {
		t.Fatalf("expected 303 redirect, got %d", cbRec.Code)
	}
	loc := cbRec.Header().Get("Location")
	if !strings.Contains(loc, "status=failed") || !strings.Contains(loc, "reason=oauth_revoked") {
		t.Fatalf("expected redirect to failed with reason=oauth_revoked, got %s", loc)
	}
	if store.hasRecord {
		t.Fatalf("credentials were saved despite revoked OAuth session")
	}
}

func TestSpotifyDBPersistenceFailure(t *testing.T) {
	_, token, users, credKeyRaw := setupSpotifyTestEnv(t)
	credKey, _ := spotify.DecodeCredentialKey(credKeyRaw)
	encAccess, _ := spotify.EncryptCredential(credKey, "access_expired")
	encRefresh, _ := spotify.EncryptCredential(credKey, "refresh_1")

	dbErr := errors.New("database connection lost")
	store := &spotifyMockStore{
		fakeStore:     &fakeStore{},
		hasRecord:     true,
		accessCipher:  encAccess,
		refreshCipher: encRefresh,
		expiresAt:     time.Now().Add(-time.Minute),
		replaceError:  dbErr, // DB fails during CAS replace
	}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), livekit.New("key", "secret"), []string{"https://mingly.site"}, nil)
	handler := server.Routes(nil)

	origTransport := http.DefaultTransport
	defer func() { http.DefaultTransport = origTransport }()
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "accounts.spotify.com" && req.URL.Path == "/api/token" {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"access_token":"new_acc","refresh_token":"new_ref","expires_in":3600}`)),
				Header:     make(http.Header),
			}, nil
		}
		return origTransport.RoundTrip(req)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/search?q=test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Database failure must not be silently swallowed
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 Bad Gateway when DB persistence fails, got %d: %s", rec.Code, rec.Body.String())
	}
}
