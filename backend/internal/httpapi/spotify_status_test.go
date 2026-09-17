package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/spotify"
)

type spotifyTestStore struct {
	*fakeStore
	accessCipher  string
	refreshCipher string
	scopes        []string
	expiresAt     time.Time
	revokedAt     *time.Time
	hasRecord     bool
}

func (s *spotifyTestStore) LoadSpotifyCredentials(_ context.Context, _ string) (string, string, []string, time.Time, *time.Time, error) {
	if !s.hasRecord {
		return "", "", nil, time.Time{}, nil, domain.ErrNotFound
	}
	return s.accessCipher, s.refreshCipher, s.scopes, s.expiresAt, s.revokedAt, nil
}

func (s *spotifyTestStore) SaveSpotifyCredentials(_ context.Context, c spotify.Credentials, accessCipher, refreshCipher string) error {
	s.hasRecord = true
	s.accessCipher = accessCipher
	s.refreshCipher = refreshCipher
	s.scopes = c.Scopes
	s.expiresAt = c.ExpiresAt
	s.revokedAt = nil
	return nil
}


func TestSpotifyStatus(t *testing.T) {
	t.Setenv("SPOTIFY_ENABLED", "true")
	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	liveKitService := livekit.New("key", "secret")
	_ = liveKitService.SetURL("http://localhost:7880")

	store := &spotifyTestStore{
		fakeStore: &fakeStore{},
	}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), liveKitService, []string{"http://localhost:3000"}, nil)
	handler := server.Routes(nil)

	// Case 1: Unauthenticated -> 401
	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/status", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}

	// Generate JWT token for user
	userToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":  "https://example.supabase.co/auth/v1",
		"sub":  "b78b0f4d-2a1d-4eb8-b99f-7a544b6c369e",
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	// Case 2: Authenticated, no connection -> connected: false
	req = httptest.NewRequest(http.MethodGet, "/api/v1/spotify/status", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var res map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res["connected"] != false || res["available"] != true {
		t.Fatalf("expected connected=false available=true, got %v", res)
	}

	// Case 3: Authenticated, valid connection -> connected: true
	store.hasRecord = true
	store.accessCipher = "enc_access"
	store.refreshCipher = "enc_refresh"
	store.scopes = []string{"streaming"}
	store.expiresAt = time.Now().Add(time.Hour)
	store.revokedAt = nil

	req = httptest.NewRequest(http.MethodGet, "/api/v1/spotify/status", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	res = nil
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res["connected"] != true || res["available"] != true {
		t.Fatalf("expected connected=true available=true, got %v", res)
	}

	// Case 4: Authenticated, revoked connection -> connected: false
	now := time.Now()
	store.revokedAt = &now
	req = httptest.NewRequest(http.MethodGet, "/api/v1/spotify/status", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	res = nil
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res["connected"] != false {
		t.Fatalf("expected connected=false for revoked connection, got %v", res)
	}
}

func TestSpotifyOAuthCallbackJSON(t *testing.T) {
	t.Setenv("SPOTIFY_ENABLED", "true")
	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	liveKitService := livekit.New("key", "secret")
	store := &spotifyTestStore{fakeStore: &fakeStore{}}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), liveKitService, []string{"http://localhost:3000"}, nil)
	handler := server.Routes(nil)

	// Invalid state with Accept: application/json returns 400 JSON
	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/callback?state=invalid&code=test", nil)
	req.Header.Set("Accept", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	var res map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res["status"] != "failed" || res["error"] != "spotify_auth_failed" {
		t.Fatalf("unexpected json response: %v", res)
	}
}

func TestSpotifyConnectCustomRedirect(t *testing.T) {
	t.Setenv("SPOTIFY_ENABLED", "true")
	t.Setenv("SPOTIFY_CLIENT_ID", "dummy_client_id")
	t.Setenv("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:3000/auth/spotify/callback")
	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	liveKitService := livekit.New("key", "secret")
	store := &spotifyTestStore{fakeStore: &fakeStore{}}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), liveKitService, []string{"http://localhost:3000", "http://127.0.0.1:3000"}, nil)
	handler := server.Routes(nil)

	userToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":  "https://example.supabase.co/auth/v1",
		"sub":  "b78b0f4d-2a1d-4eb8-b99f-7a544b6c369e",
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/connect?redirect_uri=http://localhost:3000/auth/spotify/callback&return_to=/room/test", nil)
	req.Header.Set("Authorization", "Bearer "+userToken)
	req.Header.Set("Accept", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var res map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	authURL := res["url"]
	if authURL == "" {
		t.Fatalf("expected non-empty url in response")
	}
	// Verify that the auth URL contains redirect_uri=http://localhost:3000/auth/spotify/callback
	if !strings.Contains(authURL, "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fspotify%2Fcallback") {
		t.Fatalf("expected auth URL to contain client-provided redirect_uri, got %s", authURL)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestSpotifyOAuthCallbackSuccessWithPaddedKey(t *testing.T) {
	t.Setenv("SPOTIFY_ENABLED", "true")
	t.Setenv("SPOTIFY_CLIENT_ID", "test_client_id")
	t.Setenv("SPOTIFY_REDIRECT_URI", "http://localhost:3000/auth/spotify/callback")
	// The exact padded key from backend/.env
	paddedKey := "/iJc1EhvJLCdGt2wGJm6r1SIDjFcyScuh1aft0FHUxo="
	t.Setenv("SPOTIFY_CREDENTIAL_KEY", paddedKey)

	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	liveKitService := livekit.New("key", "secret")
	store := &spotifyTestStore{fakeStore: &fakeStore{}}
	server := New(store, users, auth.NewGuestTokens("guest-secret", time.Hour), liveKitService, []string{"http://localhost:3000"}, nil)
	handler := server.Routes(nil)

	// Mock Spotify Token Endpoint
	origTransport := http.DefaultTransport
	defer func() { http.DefaultTransport = origTransport }()
	http.DefaultTransport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host == "accounts.spotify.com" && req.URL.Path == "/api/token" {
			respBody := `{"access_token":"mock_access_token_123","refresh_token":"mock_refresh_token_456","expires_in":3600}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(respBody)),
				Header:     make(http.Header),
			}, nil
		}
		return origTransport.RoundTrip(req)
	})

	// Pre-populate state
	stateID := "valid_oauth_state_uuid"
	server.spotifyMu.Lock()
	server.spotifyStates[stateID] = spotifyOAuthState{
		UserID:      "user_abc_123",
		Verifier:    "verifier_xyz_123",
		RedirectURI: "http://localhost:3000/auth/spotify/callback",
		ReturnTo:    "/settings",
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}
	server.spotifyMu.Unlock()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/spotify/callback?state="+stateID+"&code=valid_code", nil)
	req.Header.Set("Accept", "application/json")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var res map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if res["status"] != "connected" {
		t.Fatalf("expected status=connected, got %v", res)
	}

	// Verify tokens were encrypted and persisted to store
	if !store.hasRecord {
		t.Fatalf("expected store to have saved credentials")
	}
	key, err := spotify.DecodeCredentialKey(paddedKey)
	if err != nil {
		t.Fatalf("failed to decode padded key: %v", err)
	}
	decryptedAccess, err := spotify.DecryptCredential(key, store.accessCipher)
	if err != nil {
		t.Fatalf("failed to decrypt saved access token: %v", err)
	}
	if decryptedAccess != "mock_access_token_123" {
		t.Fatalf("expected decrypted access token 'mock_access_token_123', got %q", decryptedAccess)
	}
	decryptedRefresh, err := spotify.DecryptCredential(key, store.refreshCipher)
	if err != nil {
		t.Fatalf("failed to decrypt saved refresh token: %v", err)
	}
	if decryptedRefresh != "mock_refresh_token_456" {
		t.Fatalf("expected decrypted refresh token 'mock_refresh_token_456', got %q", decryptedRefresh)
	}
}


