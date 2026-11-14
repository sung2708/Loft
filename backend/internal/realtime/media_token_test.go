package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

type stubMediaTokens struct {
	token string
	err   error
	calls int
}

func (s *stubMediaTokens) Create(room domain.Room, identity domain.Identity) (string, error) {
	s.calls++
	if s.err != nil {
		return "", s.err
	}
	return s.token + ":" + room.ID + ":" + identity.LiveKitIdentity(), nil
}

func TestSnapshotCarriesMediaTokenAfterAdmission(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, _ := guests.Issue(room.ID, "Alice")
	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	issuer := &stubMediaTokens{token: "lk"}
	hub.SetMediaTokenIssuer(issuer)
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, snapshot := dialRealtimeClient(t, ctx, server.URL, token, room.ID)
	defer conn.CloseNow()
	if snapshot.Type != "room.snapshot" {
		t.Fatalf("expected snapshot, got %s", snapshot.Type)
	}
	var payload snapshotPayload
	if err := json.Unmarshal(snapshot.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.MediaToken == "" || issuer.calls != 1 {
		t.Fatalf("expected one embedded media token, got %q after %d calls", payload.MediaToken, issuer.calls)
	}
	if want := "lk:" + room.ID + ":" + payload.Self.LiveKitIdentity; payload.MediaToken != want {
		t.Fatalf("token minted for wrong participant: %q want %q", payload.MediaToken, want)
	}
}

func TestSnapshotOmitsMediaTokenWhenIssuerFails(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, _ := guests.Issue(room.ID, "Alice")
	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetMediaTokenIssuer(&stubMediaTokens{err: errors.New("LiveKit is not configured")})
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, snapshot := dialRealtimeClient(t, ctx, server.URL, token, room.ID)
	defer conn.CloseNow()
	if snapshot.Type != "room.snapshot" {
		t.Fatalf("token failure must not block admission, got %s", snapshot.Type)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(snapshot.Payload, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["mediaToken"]; ok {
		t.Fatal("failed issuer should leave mediaToken out so the client falls back to HTTP")
	}
}
