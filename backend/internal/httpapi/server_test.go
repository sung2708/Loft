package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
)

type fakeStore struct {
	created        domain.CreateRoomParams
	room           domain.Room
	deletedRoomID  string
	deletedOwnerID string
}

func (f *fakeStore) Ping(context.Context) error                           { return nil }
func (f *fakeStore) UpsertProfile(context.Context, domain.Identity) error { return nil }
func (f *fakeStore) CreateRoom(_ context.Context, params domain.CreateRoomParams) (domain.Room, error) {
	f.created = params
	return domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", Name: params.Name, OwnerID: params.Owner.ID, AllowGuests: params.AllowGuests}, nil
}
func (f *fakeStore) GetRoom(_ context.Context, identifier string) (domain.Room, error) {
	if f.room.ID == identifier || f.room.Slug == identifier {
		return f.room, nil
	}
	return domain.Room{}, domain.ErrNotFound
}
func (f *fakeStore) ListOwnedRooms(context.Context, string) ([]domain.Room, error) { return nil, nil }
func (f *fakeStore) DeleteOwnedRoom(_ context.Context, roomID, ownerID string) error {
	f.deletedRoomID, f.deletedOwnerID = roomID, ownerID
	return nil
}
func (f *fakeStore) InsertMessage(context.Context, string, domain.Identity, string) (domain.Message, error) {
	return domain.Message{}, nil
}
func (f *fakeStore) RecentMessages(context.Context, string, int) ([]domain.Message, error) {
	return nil, nil
}
func (f *fakeStore) Close() {}

type fakeDeletionGuard struct {
	busy     bool
	finished bool
	deleted  bool
}

func (g *fakeDeletionGuard) BeginDelete(string) bool { return !g.busy }
func (g *fakeDeletionGuard) FinishDelete(_ string, deleted bool) {
	g.finished, g.deleted = true, deleted
}

func TestDeleteRoomOwnerOnlyAndBusyRoom(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	const roomID = "58bb9fe4-79bc-41c7-9d63-61c04815b668"
	const ownerID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	store := &fakeStore{room: domain.Room{ID: roomID, OwnerID: ownerID}}
	guard := &fakeDeletionGuard{}
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)), guard)
	handler := server.Routes(http.NotFoundHandler())
	path := "/api/v1/rooms/" + roomID
	request := func(userID string) *http.Request {
		req := httptest.NewRequest(http.MethodDelete, path, nil)
		if userID != "" {
			claims := jwt.MapClaims{"sub": userID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}
			raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+raw)
		}
		return req
	}
	for _, tc := range []struct {
		userID string
		busy   bool
		status int
	}{
		{"", false, http.StatusUnauthorized},
		{"11111111-1111-4111-8111-111111111111", false, http.StatusNotFound},
		{ownerID, true, http.StatusConflict},
		{ownerID, false, http.StatusNoContent},
	} {
		guard.busy = tc.busy
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, request(tc.userID))
		if result.Code != tc.status {
			t.Fatalf("user %q busy %t: got %d, want %d: %s", tc.userID, tc.busy, result.Code, tc.status, result.Body.String())
		}
	}
	if store.deletedRoomID != roomID || store.deletedOwnerID != ownerID || !guard.finished || !guard.deleted {
		t.Fatalf("delete was not completed for owner: store=%+v guard=%+v", store, guard)
	}
}

func TestCreateRoomRequiresAuthenticatedUser(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	store := new(fakeStore)
	users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)
	server := New(store, users, auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	handler := server.Routes(http.NotFoundHandler())

	unauthorized := httptest.NewRequest(http.MethodPost, "/api/v1/rooms", strings.NewReader(`{"name":"Late Night Coding"}`))
	unauthorized.RemoteAddr = "127.0.0.1:1001"
	unauthorizedResult := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedResult, unauthorized)
	if unauthorizedResult.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthorizedResult.Code)
	}

	userID := "4ff036f8-834c-4cb5-9097-30710442e19e"
	claims := jwt.MapClaims{"sub": userID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "email": "minh@example.com", "exp": time.Now().Add(time.Hour).Unix()}
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	authorized := httptest.NewRequest(http.MethodPost, "/api/v1/rooms", strings.NewReader(`{"name":"Late Night Coding","allow_guests":true}`))
	authorized.RemoteAddr = "127.0.0.2:1002"
	authorized.Header.Set("Authorization", "Bearer "+raw)
	authorizedResult := httptest.NewRecorder()
	handler.ServeHTTP(authorizedResult, authorized)
	if authorizedResult.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", authorizedResult.Code, authorizedResult.Body.String())
	}
	if store.created.Owner.ID != userID || store.created.Name != "Late Night Coding" {
		t.Fatalf("server did not derive owner from JWT: %#v", store.created)
	}
}

func TestResolveRoomNormalizesInviteURLAndHidesPrivateFields(t *testing.T) {
	store := &fakeStore{room: domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", Slug: "abcd1234", Name: "Late Night Coding", OwnerID: "private-owner-id", AllowGuests: true, MaxParticipants: 12, PasswordRequired: true, PasswordVerifier: "private-password-verifier"}}
	secret := "12345678901234567890123456789012"
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/resolve?value=https%3A%2F%2Floft.app%2Fjoin%2FABCD1234", nil)
	request.RemoteAddr = "127.0.0.1:1003"
	result := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(result, request)
	if result.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", result.Code, result.Body.String())
	}
	if strings.Contains(result.Body.String(), "private-owner-id") || strings.Contains(result.Body.String(), "private-password-verifier") || strings.Contains(result.Body.String(), "password_verifier") || !strings.Contains(result.Body.String(), `"slug":"abcd1234"`) || !strings.Contains(result.Body.String(), `"password_required":true`) {
		t.Fatalf("unsafe or invalid preview: %s", result.Body.String())
	}
}

func TestGuestSessionRejectsLockedRoom(t *testing.T) {
	const roomID = "58bb9fe4-79bc-41c7-9d63-61c04815b668"
	store := &fakeStore{room: domain.Room{ID: roomID, AllowGuests: true, IsLocked: true}}
	secret := "12345678901234567890123456789012"
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/"+roomID+"/guest-session", strings.NewReader(`{"display_name":"Guest"}`))
	request.RemoteAddr = "127.0.0.1:1004"
	result := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(result, request)
	if result.Code != http.StatusForbidden || !strings.Contains(result.Body.String(), `"code":"ROOM_LOCKED"`) {
		t.Fatalf("locked guest session was not rejected clearly: status=%d body=%s", result.Code, result.Body.String())
	}
}

func TestGuestSessionRejectsInvalidRoomPassword(t *testing.T) {
	const roomID = "58bb9fe4-79bc-41c7-9d63-61c04815b668"
	verifier, err := auth.HashRoomPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeStore{room: domain.Room{ID: roomID, AllowGuests: true, PasswordRequired: true, PasswordVerifier: verifier}}
	secret := "12345678901234567890123456789012"
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/"+roomID+"/guest-session", strings.NewReader(`{"display_name":"Guest","password":"wrong"}`))
	request.RemoteAddr = "127.0.0.1:1005"
	result := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(result, request)
	if result.Code != http.StatusForbidden || !strings.Contains(result.Body.String(), `"code":"INVALID_ROOM_PASSWORD"`) {
		t.Fatalf("invalid password was not rejected: %d %s", result.Code, result.Body.String())
	}
}

func TestWebSocketRouteDoesNotInheritHTTPTimeout(t *testing.T) {
	secret := "12345678901234567890123456789012"
	server := New(new(fakeStore), auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	websocketHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, hasDeadline := r.Context().Deadline(); hasDeadline {
			t.Error("WebSocket route inherited short HTTP timeout")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	handler := server.Routes(websocketHandler)
	wsResult := httptest.NewRecorder()
	handler.ServeHTTP(wsResult, httptest.NewRequest(http.MethodGet, "/ws", nil))
	if wsResult.Code != http.StatusNoContent {
		t.Fatalf("WebSocket route returned %d", wsResult.Code)
	}

	healthResult := httptest.NewRecorder()
	handler.ServeHTTP(healthResult, httptest.NewRequest(http.MethodGet, "/health", nil))
	if healthResult.Code != http.StatusOK {
		t.Fatalf("HTTP route returned %d", healthResult.Code)
	}
}

func TestRoomAppearanceSerializationAndSafeDefaults(t *testing.T) {
	legacyRoom := domain.Room{
		ID:               "58bb9fe4-79bc-41c7-9d63-61c04815b668",
		Slug:             "legacy-room",
		Name:             "Legacy Room",
		OwnerID:          "private-owner-id",
		AllowGuests:      true,
		MaxParticipants:  12,
		PasswordRequired: false,
		PasswordVerifier: "super-secret-verifier",
	}

	secret := "12345678901234567890123456789012"
	store := &fakeStore{room: legacyRoom}
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/resolve?value=legacy-room", nil)
	rec := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := rec.Body.String()
	// Must have safe semantic defaults
	if !strings.Contains(body, `"atmosphere":"ambient"`) {
		t.Fatalf("missing default atmosphere: %s", body)
	}
	if !strings.Contains(body, `"accent":"blue"`) {
		t.Fatalf("missing default accent: %s", body)
	}
	if !strings.Contains(body, `"adaptive_media_background":true`) {
		t.Fatalf("missing default adaptive_media_background: %s", body)
	}

	// Must never leak private or forbidden fields
	forbidden := []string{
		"super-secret-verifier",
		"password_verifier",
		"private-owner-id",
		"palette",
		"artwork",
		"personal_theme",
		"theme",
		"style",
		"css",
		"background",
	}
	for _, term := range forbidden {
		if strings.Contains(strings.ToLower(body), `"`+term+`"`) {
			t.Fatalf("response leaked forbidden/styling field %q: %s", term, body)
		}
	}

	// Configured appearance
	configuredRoom := domain.Room{
		ID:                      "58bb9fe4-79bc-41c7-9d63-61c04815b668",
		Slug:                      "party-room",
		Name:                    "Party Room",
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
	}
	store.room = configuredRoom

	req = httptest.NewRequest(http.MethodGet, "/api/v1/rooms/resolve?value=party-room", nil)
	rec = httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	partyBody := rec.Body.String()
	if !strings.Contains(partyBody, `"atmosphere":"party"`) ||
		!strings.Contains(partyBody, `"accent":"rose"`) ||
		!strings.Contains(partyBody, `"adaptive_media_background":false`) {
		t.Fatalf("configured appearance not serialized correctly: %s", partyBody)
	}
}
