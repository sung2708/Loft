package httpapi

import (
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

type joinRequestNotifier struct {
	rooms   []string
	created []bool
}

func (n *joinRequestNotifier) BeginDelete(string) bool   { return true }
func (n *joinRequestNotifier) FinishDelete(string, bool) {}
func (n *joinRequestNotifier) NotifyJoinRequestsChanged(id string, created bool) {
	n.rooms = append(n.rooms, id)
	n.created = append(n.created, created)
}

func TestJoinRequestChangesNotifyHostOnce(t *testing.T) {
	const secret = "12345678901234567890123456789012"
	const roomID = "58bb9fe4-79bc-41c7-9d63-61c04815b668"
	const ownerID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	const requesterID = "5ff036f8-834c-4cb5-9097-30710442e19e"
	store := &membershipStore{
		fakeStore: &fakeStore{room: domain.Room{ID: roomID, OwnerID: ownerID, AllowGuests: false}},
		members:   map[string]bool{}, requests: make(map[string]domain.JoinRequest),
	}
	notifier := &joinRequestNotifier{}
	server := New(store, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret), auth.NewGuestTokens(secret, time.Hour), livekit.New("", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)), notifier)
	handler := server.Routes(http.NotFoundHandler())
	token := func(userID string) string {
		claims := jwt.MapClaims{"sub": userID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}
		raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	call := func(method, path, raw string, body io.Reader) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, body)
		req.Header.Set("Authorization", "Bearer "+raw)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result
	}

	// The waiting page re-POSTs every few seconds; only the first creates a request.
	for i := 0; i < 3; i++ {
		if result := call(http.MethodPost, "/api/v1/rooms/"+roomID+"/join-requests", token(requesterID), nil); result.Code != http.StatusAccepted {
			t.Fatalf("request access got %d: %s", result.Code, result.Body.String())
		}
	}
	if len(notifier.rooms) != 1 || notifier.rooms[0] != roomID || !notifier.created[0] {
		t.Fatalf("expected one notification for a new request, got %v", notifier.rooms)
	}
	if result := call(http.MethodPatch, "/api/v1/rooms/"+roomID+"/join-requests/"+requesterID, token(ownerID), strings.NewReader(`{"approve":false}`)); result.Code != http.StatusOK {
		t.Fatalf("resolve got %d: %s", result.Code, result.Body.String())
	}
	if len(notifier.rooms) != 2 || notifier.rooms[1] != roomID || notifier.created[1] {
		t.Fatalf("resolving should notify, got %v", notifier.rooms)
	}
	result := call(http.MethodGet, "/api/v1/rooms/"+roomID+"/join-requests/status", token(requesterID), nil)
	if result.Code != http.StatusOK || !strings.Contains(result.Body.String(), `"status":"rejected"`) || len(notifier.rooms) != 2 {
		t.Fatalf("status lookup recreated a rejected request: %d %s", result.Code, result.Body.String())
	}
}
