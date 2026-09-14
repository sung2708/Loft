package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

type realtimeStore struct{ room domain.Room }

func (s *realtimeStore) Ping(context.Context) error                           { return nil }
func (s *realtimeStore) UpsertProfile(context.Context, domain.Identity) error { return nil }
func (s *realtimeStore) CreateRoom(context.Context, domain.CreateRoomParams) (domain.Room, error) {
	return domain.Room{}, nil
}

func TestConcurrentRoomAdmission(t *testing.T) {
	for _, duplicate := range []bool{false, true} {
		room := domain.Room{ID: uuid.NewString(), MaxParticipants: 12}
		hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
		var admitted atomic.Int32
		var workers sync.WaitGroup
		for i := 0; i < 50; i++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				identity := uuid.NewString()
				if duplicate {
					identity = "same-guest"
				}
				c := &client{id: uuid.NewString(), roomID: room.ID, identity: domain.Identity{ID: identity, Type: domain.IdentityGuest}}
				if _, _, ok := hub.add(c, room); ok {
					admitted.Add(1)
				}
			}()
		}
		workers.Wait()
		want := int32(12)
		if duplicate {
			want = 1
		}
		if admitted.Load() != want {
			t.Fatalf("duplicate=%v admitted=%d want=%d", duplicate, admitted.Load(), want)
		}
	}
}

func TestDuplicateSessionAndShutdown(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 2}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, err := guests.Issue(room.ID, "QA")
	if err != nil {
		t.Fatal(err)
	}
	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	join := func() (*websocket.Conn, Envelope) {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.CloseNow() })
		payload, _ := json.Marshal(authPayload{Token: token, RoomID: room.ID})
		if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, Payload: payload}); err != nil {
			t.Fatal(err)
		}
		var response Envelope
		if err := wsjson.Read(ctx, conn, &response); err != nil {
			t.Fatal(err)
		}
		return conn, response
	}
	first, snapshot := join()
	if snapshot.Type != "room.snapshot" {
		t.Fatal("initial join failed")
	}
	_, denied := join()
	var reason errorPayload
	_ = json.Unmarshal(denied.Payload, &reason)
	if denied.Type != "error" || reason.Code != "DUPLICATE_SESSION" {
		t.Fatalf("duplicate admitted: %s %s", denied.Type, reason.Code)
	}
	if err := wsjson.Write(ctx, first, Envelope{Type: "connection.ping", Version: 1}); err != nil {
		t.Fatal(err)
	}
	var pong Envelope
	if err := wsjson.Read(ctx, first, &pong); err != nil || pong.Type != "connection.pong" {
		t.Fatal("duplicate displaced original session")
	}
	if err := hub.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, first, &pong); err == nil {
		t.Fatal("shutdown left socket open")
	}
	hub.mu.RLock()
	remaining := len(hub.rooms[room.ID].clients)
	hub.mu.RUnlock()
	if remaining != 0 {
		t.Fatal("shutdown left participants")
	}
	response, err := http.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatal("shutdown accepted new handler")
	}
}

func TestIdleWebSocketExpires(t *testing.T) {
	accepted := make(chan *websocket.Conn, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		accepted <- conn
		<-release
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	peer, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.CloseNow()
	hub := &Hub{idleTimeout: 20 * time.Millisecond}
	if err := hub.readPump(ctx, &client{conn: <-accepted}); err == nil {
		t.Fatal("idle reader did not expire")
	}
	if ctx.Err() != nil {
		t.Fatal("reader used outer timeout instead of idle deadline")
	}
}
func (s *realtimeStore) GetRoom(_ context.Context, id string) (domain.Room, error) {
	if id == s.room.ID {
		return s.room, nil
	}
	return domain.Room{}, domain.ErrNotFound
}
func (s *realtimeStore) ListOwnedRooms(context.Context, string) ([]domain.Room, error) {
	return nil, nil
}
func (s *realtimeStore) DeleteOwnedRoom(context.Context, string, string) error { return nil }
func (s *realtimeStore) InsertMessage(context.Context, string, domain.Identity, string) (domain.Message, error) {
	return domain.Message{}, nil
}
func (s *realtimeStore) RecentMessages(context.Context, string, int) ([]domain.Message, error) {
	return []domain.Message{}, nil
}
func (s *realtimeStore) Close() {}

func TestDeleteGuardBlocksJoinsAndActiveRooms(t *testing.T) {
	room := domain.Room{ID: uuid.NewString()}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	first := &client{id: uuid.NewString(), roomID: room.ID}
	if _, _, added := hub.add(first, room); !added {
		t.Fatal("first participant could not join")
	}
	if hub.BeginDelete(room.ID) {
		t.Fatal("active room was deletable")
	}
	hub.mu.Lock()
	delete(hub.rooms[room.ID].clients, first.id)
	hub.mu.Unlock()
	if !hub.BeginDelete(room.ID) || hub.BeginDelete(room.ID) {
		t.Fatal("deletion guard did not reserve room exactly once")
	}
	if _, _, added := hub.add(&client{id: uuid.NewString(), roomID: room.ID}, room); added {
		t.Fatal("participant joined during deletion")
	}
	hub.FinishDelete(room.ID, false)
	if _, _, added := hub.add(&client{id: uuid.NewString(), roomID: room.ID}, room); !added {
		t.Fatal("failed delete did not release room")
	}
}

func TestGuestAuthenticatesAndReceivesSnapshot(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Night room", AllowGuests: true}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	raw, _, _, err := guests.Issue(room.ID, "Minh")
	if err != nil {
		t.Fatal(err)
	}
	hub := New(&realtimeStore{room: room}, guests, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "test complete")
	payload := []byte(`{"token":"` + raw + `","room_id":"` + room.ID + `"}`)
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: payload}); err != nil {
		t.Fatal(err)
	}
	var response Envelope
	if err := wsjson.Read(ctx, conn, &response); err != nil {
		t.Fatal(err)
	}
	if response.Type != "room.snapshot" || response.RoomID != room.ID {
		t.Fatalf("unexpected event: %#v", response)
	}
}

func TestTwoGuestsQueueAndReactionsOverWebSocket(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Music room", AllowGuests: true}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	hub := New(&realtimeStore{room: room}, guests, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	connections := make([]*websocket.Conn, 0, 2)
	for _, name := range []string{"Guest A", "Guest B"} {
		raw, _, _, err := guests.Issue(room.ID, name)
		if err != nil {
			t.Fatal(err)
		}
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close(websocket.StatusNormalClosure, "test complete")
		connections = append(connections, conn)
		payload, _ := json.Marshal(authPayload{Token: raw, RoomID: room.ID})
		if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: payload}); err != nil {
			t.Fatal(err)
		}
		var snapshot Envelope
		if err := wsjson.Read(ctx, conn, &snapshot); err != nil {
			t.Fatal(err)
		}
		if snapshot.Type != "room.snapshot" {
			t.Fatalf("expected snapshot, got %s", snapshot.Type)
		}
	}
	for i, conn := range connections {
		id := "dQw4w9WgXcQ"
		if i == 1 {
			id = "M7lc1UVf-VE"
		}
		payload, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/" + id})
		if err := wsjson.Write(ctx, conn, Envelope{Type: "queue.add", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: payload}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 10; i++ {
		for _, conn := range connections {
			if err := wsjson.Write(ctx, conn, Envelope{Type: "reaction.send", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: json.RawMessage(`{"emoji":"👏"}`)}); err != nil {
				t.Fatal(err)
			}
		}
	}
	latestVersion := uint64(0)
	reactions := 0
	for latestVersion < 2 || reactions < 2 {
		var response Envelope
		if err := wsjson.Read(ctx, connections[0], &response); err != nil {
			t.Fatal(err)
		}
		if response.Type == "media.state" {
			var state mediaState
			if err := json.Unmarshal(response.Payload, &state); err != nil {
				t.Fatal(err)
			}
			if state.Version > latestVersion {
				latestVersion = state.Version
			}
			if state.Version == 2 && (state.Current == nil || len(state.Queue) != 1) {
				t.Fatalf("concurrent queue lost an item: %+v", state)
			}
		}
		if response.Type == "reaction.sent" {
			reactions++
		}
	}
	if reactions > 8 {
		t.Fatalf("reaction rate limit failed: %d", reactions)
	}
}

func TestMediaTimerAdvancesWithoutClientEndEvent(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), OwnerID: "host"}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	c := &client{id: uuid.NewString(), roomID: room.ID, send: make(chan []byte, 2)}
	if _, _, ok := hub.add(c, room); !ok {
		t.Fatal("could not join")
	}
	hub.mu.Lock()
	state := hub.rooms[room.ID]
	state.media = mediaState{
		Current: &youtubeTrack{ID: "a", DurationSec: 1},
		Queue:   []youtubeTrack{{ID: "b"}}, Status: "PLAYING", StartedAt: time.Now().Add(-900 * time.Millisecond),
	}
	hub.scheduleMediaEnd(room.ID, state)
	hub.mu.Unlock()
	select {
	case data := <-c.send:
		var envelope Envelope
		if err := json.Unmarshal(data, &envelope); err != nil || envelope.Type != "media.state" {
			t.Fatalf("unexpected timer event: %v %s", err, data)
		}
		var media mediaState
		if err := json.Unmarshal(envelope.Payload, &media); err != nil || media.Current == nil || media.Current.ID != "b" {
			t.Fatalf("timer did not advance queue: %+v %v", media, err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("media timer did not advance")
	}
	hub.FinishDelete(room.ID, true)
}

func TestQueueMutationRateLimit(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	raw, _, _, err := guests.Issue(room.ID, "Guest")
	if err != nil {
		t.Fatal(err)
	}
	hub := New(&realtimeStore{room: room}, guests, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "test complete")
	authData, _ := json.Marshal(authPayload{Token: raw, RoomID: room.ID})
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, Payload: authData}); err != nil {
		t.Fatal(err)
	}
	var snapshot Envelope
	if err := wsjson.Read(ctx, conn, &snapshot); err != nil || snapshot.Type != "room.snapshot" {
		t.Fatalf("snapshot: %s %v", snapshot.Type, err)
	}
	command, _ := json.Marshal(mediaCommand{URL: "https://youtu.be/dQw4w9WgXcQ"})
	for i := 0; i < 11; i++ {
		if err := wsjson.Write(ctx, conn, Envelope{Type: "queue.add", Version: 1, Payload: command}); err != nil {
			t.Fatal(err)
		}
	}
	accepted, limited := 0, 0
	for i := 0; i < 11; i++ {
		var response Envelope
		if err := wsjson.Read(ctx, conn, &response); err != nil {
			t.Fatal(err)
		}
		switch response.Type {
		case "media.state":
			accepted++
		case "error":
			var payload errorPayload
			if err := json.Unmarshal(response.Payload, &payload); err != nil || payload.Code != "MEDIA_RATE_LIMITED" {
				t.Fatalf("wrong rate limit response: %+v %v", payload, err)
			}
			limited++
		default:
			t.Fatalf("unexpected event: %s", response.Type)
		}
	}
	if accepted != 10 || limited != 1 {
		t.Fatalf("queue rate limit: accepted=%d limited=%d", accepted, limited)
	}
}

func TestSlowConsumerDoesNotBlockBroadcast(t *testing.T) {
	accepted := make(chan *websocket.Conn, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		accepted <- conn
		<-release
		_ = conn.CloseNow()
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	peer, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.CloseNow()
	conn := <-accepted
	room := domain.Room{ID: "slow-consumer-room"}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	slow := &client{id: "slow", conn: conn, send: make(chan []byte, 1)}
	slow.send <- []byte("full")
	fast := &client{id: "fast", send: make(chan []byte, 1)}
	hub.rooms[room.ID] = &roomState{clients: map[string]*client{"slow": slow, "fast": fast}}
	done := make(chan struct{})
	go func() { hub.broadcast(room.ID, []byte("event"), ""); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		_ = peer.CloseNow()
		<-done
		t.Fatal("broadcast waited for a slow consumer's close handshake")
	}
	select {
	case <-fast.send:
	default:
		t.Fatal("healthy client did not receive broadcast")
	}
}
