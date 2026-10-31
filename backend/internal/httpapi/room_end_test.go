package httpapi

import (
	"context"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type endingStore struct {
	*fakeStore
	mu     sync.Mutex
	ended  bool
	endErr error
}

func (s *endingStore) GetRoom(context.Context, string) (domain.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return s.room, domain.ErrRoomEnded
	}
	return s.room, nil
}
func (s *endingStore) EndOwnedRoom(_ context.Context, _ string, owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if owner != s.room.OwnerID {
		return domain.ErrNotFound
	}
	if s.endErr != nil {
		return s.endErr
	}
	s.ended = true
	return nil
}

type endNotifier struct{ notified int }

func (*endNotifier) BeginDelete(string) bool   { return true }
func (*endNotifier) FinishDelete(string, bool) {}
func (n *endNotifier) NotifyRoomEnded(string)  { n.notified++ }
func TestEndRoomOwnerOnlyDurableAndIdempotent(t *testing.T) {
	room := domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", OwnerID: "11111111-1111-4111-8111-111111111111", AllowGuests: true}
	repo := &endingStore{fakeStore: &fakeStore{room: room}}
	notifier := &endNotifier{}
	secret := "12345678901234567890123456789012"
	verifier := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)
	server := New(repo, verifier, auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)), notifier)
	token := func(id string) string {
		raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": id, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(), "email": "test@example.com"}).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	call := func(method, path, bearer string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		server.Routes(http.NotFoundHandler()).ServeHTTP(w, r)
		return w
	}
	path := "/api/v1/rooms/" + room.ID + "/end"
	if got := call("POST", path, ""); got.Code != 401 {
		t.Fatal(got.Code)
	}
	if got := call("POST", path, token("22222222-2222-4222-8222-222222222222")); got.Code != 403 || repo.ended {
		t.Fatal("member ended room", got.Code)
	}
	repo.endErr = errors.New("database unavailable")
	if got := call("POST", path, token(room.OwnerID)); got.Code != 500 || notifier.notified != 0 {
		t.Fatal("failed persistence disconnected room", got.Code)
	}
	repo.endErr = nil
	for i := 0; i < 2; i++ {
		if got := call("POST", path, token(room.OwnerID)); got.Code != 204 {
			t.Fatal(got.Code, got.Body.String())
		}
	}
	if !repo.ended || notifier.notified != 2 || repo.deletedRoomID != "" {
		t.Fatal("end deleted data or failed to notify")
	}
	if got := call("GET", "/api/v1/rooms/"+room.ID, ""); got.Code != 410 {
		t.Fatal("ended link remained open", got.Code)
	}
	if got := call("POST", "/api/v1/rooms/"+room.ID+"/guest-session", ""); got.Code != 410 {
		t.Fatal("ended room issued guest session", got.Code)
	}
	if got := call("POST", "/api/v1/rooms/"+room.ID+"/livekit-token", token(room.OwnerID)); got.Code != 410 {
		t.Fatal("ended room issued media token", got.Code)
	}
}
