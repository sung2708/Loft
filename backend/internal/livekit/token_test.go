package livekit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestRemoveParticipantCallsRoomServiceWithAdminGrant(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Method != http.MethodPost || r.URL.Path != "/twirp/livekit.RoomService/RemoveParticipant" {
			t.Errorf("unexpected LiveKit request: %s %s", r.Method, r.URL.Path)
		}
		raw := r.Header.Get("Authorization")
		if len(raw) < 8 || raw[:7] != "Bearer " {
			t.Error("missing admin authorization")
			return
		}
		claims := new(claims)
		parsed, err := jwt.ParseWithClaims(raw[7:], claims, func(*jwt.Token) (any, error) { return []byte("secret"), nil })
		if err != nil || !parsed.Valid || !claims.Video.RoomAdmin || claims.Video.Room != "room-id" {
			t.Errorf("invalid admin token: %v %+v", err, claims.Video)
		}
		var body struct {
			Room          string `json:"room"`
			Identity      string `json:"identity"`
			RevokeTokenTS int64  `json:"revoke_token_ts"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Room != "room-id" || body.Identity != "guest:guest-id" || body.RevokeTokenTS == 0 {
			t.Errorf("invalid removal body: %+v", body)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	service := New("key", "secret")
	if err := service.SetURL(server.URL); err != nil {
		t.Fatal(err)
	}
	if err := service.RemoveParticipant(context.Background(), "room-id", "guest:guest-id"); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("RoomService was not called")
	}
}
