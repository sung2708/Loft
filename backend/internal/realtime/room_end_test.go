package realtime

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket/wsjson"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestEndingRoomDisconnectsEveryoneAndStopsMedia(t *testing.T) {
	room := domain.Room{ID: "ended-room", AllowGuests: true, MaxParticipants: 12}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, nil)
	server := httptest.NewServer(hub)
	defer server.Close()
	defer hub.Shutdown(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	first := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Alice")
	defer first.CloseNow()
	second := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Bob")
	defer second.CloseNow()
	hub.NotifyRoomEnded(room.ID)
	readEnd := func(read func(context.Context, *Envelope) error) {
		for {
			var message Envelope
			if err := read(ctx, &message); err != nil {
				t.Fatal("terminal event missing", err)
			}
			if message.Type == "room.ended" {
				break
			}
		}
	}
	readEnd(func(ctx context.Context, e *Envelope) error { return wsjson.Read(ctx, first, e) })
	readEnd(func(ctx context.Context, e *Envelope) error { return wsjson.Read(ctx, second, e) })
	hub.mu.RLock()
	state := hub.rooms[room.ID]
	ended := state.ended
	media := state.media.snapshot()
	timer := state.mediaTimer
	hub.mu.RUnlock()
	if !ended || media.Current != nil || media.Status != "IDLE" || timer != nil {
		t.Fatal("ended room retained playback")
	}
	response := hub.handleForwardedMedia(ctx, mediaRPCRequest{RoomID: room.ID, Kind: "queue.add", Payload: json.RawMessage(`{"url":"https://youtu.be/dQw4w9WgXcQ"}`), Actor: domain.Identity{ID: "g", Type: domain.IdentityGuest, RoomID: room.ID}})
	if response.Error == "" {
		t.Fatal("ended room accepted command")
	}
}

type endFallbackStore struct {
	realtimeStore
	ended atomic.Bool
}

func (s *endFallbackStore) GetRoom(_ context.Context, _ string) (domain.Room, error) {
	if s.ended.Load() {
		return s.room, domain.ErrRoomEnded
	}
	return s.room, nil
}
func TestRoomEndRecoversFromMissedNotificationOnHeartbeat(t *testing.T) {
	room := domain.Room{ID: "missed-end", AllowGuests: true, MaxParticipants: 12}
	repo := &endFallbackStore{realtimeStore: realtimeStore{room: room}}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	hub := New(repo, guests, nil, []string{"http://localhost:3000"}, nil)
	server := httptest.NewServer(hub)
	defer server.Close()
	defer hub.Shutdown(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Alice")
	defer connection.CloseNow()
	repo.ended.Store(true)
	if err := wsjson.Write(ctx, connection, Envelope{Type: "connection.ping", Version: 1, RoomID: room.ID, Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	for {
		var message Envelope
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "room.ended" {
			break
		}
	}
}

func TestRoomEndRecoversWithoutClientHeartbeat(t *testing.T) {
	room := domain.Room{ID: "no-heartbeat", AllowGuests: true, MaxParticipants: 12}
	repo := &endFallbackStore{realtimeStore: realtimeStore{room: room}}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	hub := New(repo, guests, nil, []string{"http://localhost:3000"}, nil)
	server := httptest.NewServer(hub)
	defer server.Close()
	defer hub.Shutdown(context.Background())
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	connection := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Alice")
	defer connection.CloseNow()
	repo.ended.Store(true)
	// No client ping and no bus notification: the server must discover the closure.
	for {
		var message Envelope
		if err := wsjson.Read(ctx, connection, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type == "room.ended" {
			break
		}
	}
}
