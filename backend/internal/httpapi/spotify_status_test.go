package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
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
