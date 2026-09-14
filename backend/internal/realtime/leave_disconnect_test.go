package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

func dialRealtimeClient(t *testing.T, ctx context.Context, serverURL, token, roomID string) (*websocket.Conn, Envelope) {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(serverURL, "http"), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}},
	})
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	payload, _ := json.Marshal(authPayload{Token: token, RoomID: roomID})
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, Payload: payload}); err != nil {
		_ = conn.CloseNow()
		t.Fatalf("write auth: %v", err)
	}
	var snapshot Envelope
	if err := wsjson.Read(ctx, conn, &snapshot); err != nil {
		_ = conn.CloseNow()
		t.Fatalf("read snapshot: %v", err)
	}
	return conn, snapshot
}

func TestNormalLeave(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")
	tokenB, _, _, _ := guests.Issue(room.ID, "Bob")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetDisconnectGracePeriod(500 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connB, _ := dialRealtimeClient(t, ctx, server.URL, tokenB, room.ID)
	defer connB.CloseNow()

	connA, _ := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	defer connA.CloseNow()

	// Bob receives participant.joined for Alice
	var joined Envelope
	if err := wsjson.Read(ctx, connB, &joined); err != nil || joined.Type != "participant.joined" {
		t.Fatalf("bob expected participant.joined, got %v (%s)", err, joined.Type)
	}

	// Alice performs a normal clean leave by sending room.leave
	if err := wsjson.Write(ctx, connA, Envelope{Type: "room.leave", Version: 1}); err != nil {
		t.Fatalf("alice send room.leave: %v", err)
	}
	_ = connA.Close(websocket.StatusNormalClosure, "leaving room")

	// Bob should receive participant.left IMMEDIATELY (without waiting for grace period)
	start := time.Now()
	var left Envelope
	if err := wsjson.Read(ctx, connB, &left); err != nil || left.Type != "participant.left" {
		t.Fatalf("bob expected participant.left, got %v (%s)", err, left.Type)
	}
	if elapsed := time.Since(start); elapsed > 250*time.Millisecond {
		t.Fatalf("normal leave should be immediate, took %v", elapsed)
	}

	// Verify Alice is completely removed from room state
	hub.mu.RLock()
	clients := hub.rooms[room.ID].clients
	hub.mu.RUnlock()
	if len(clients) != 1 {
		t.Fatalf("expected 1 remaining client in room, got %d", len(clients))
	}
}

func TestDisconnectWithGracePeriodExpiry(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")
	tokenB, _, _, _ := guests.Issue(room.ID, "Bob")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Set grace period to 100ms for fast deterministic testing
	hub.SetDisconnectGracePeriod(100 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connB, _ := dialRealtimeClient(t, ctx, server.URL, tokenB, room.ID)
	defer connB.CloseNow()

	connA, _ := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)

	// Bob receives participant.joined for Alice
	var joined Envelope
	if err := wsjson.Read(ctx, connB, &joined); err != nil || joined.Type != "participant.joined" {
		t.Fatalf("bob expected participant.joined, got %v (%s)", err, joined.Type)
	}

	// Alice abruptly closes socket (tab close / crash) without sending room.leave
	_ = connA.CloseNow()

	// Bob should NOT immediately receive participant.left during grace period
	readDone := make(chan Envelope, 1)
	go func() {
		var env Envelope
		_ = wsjson.Read(ctx, connB, &env)
		readDone <- env
	}()

	select {
	case env := <-readDone:
		if env.Type == "participant.left" {
			t.Fatalf("received participant.left before grace period expired")
		}
	case <-time.After(50 * time.Millisecond):
		// Expected: still in grace period, no left event yet
	}

	// After grace period (100ms) expires, Bob must receive participant.left
	select {
	case env := <-readDone:
		if env.Type != "participant.left" {
			t.Fatalf("expected participant.left after grace period, got %s", env.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for participant.left after grace period")
	}

	// Alice should now be removed from room state
	hub.mu.RLock()
	clients := hub.rooms[room.ID].clients
	hub.mu.RUnlock()
	if len(clients) != 1 {
		t.Fatalf("expected 1 remaining client, got %d", len(clients))
	}
}

func TestReconnectBeforeTimeout(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")
	tokenB, _, _, _ := guests.Issue(room.ID, "Bob")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Set grace period to 300ms
	hub.SetDisconnectGracePeriod(300 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connB, _ := dialRealtimeClient(t, ctx, server.URL, tokenB, room.ID)
	defer connB.CloseNow()

	connA1, snap1 := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	var snapPayload1 snapshotPayload
	_ = json.Unmarshal(snap1.Payload, &snapPayload1)
	originalConnectionID := snapPayload1.Self.ConnectionID

	// Bob gets participant.joined
	var joined Envelope
	_ = wsjson.Read(ctx, connB, &joined)

	// Alice abruptly closes connection (e.g. page refresh or network blip)
	_ = connA1.CloseNow()

	// Wait 50ms (well within the 300ms grace period)
	time.Sleep(50 * time.Millisecond)

	// Alice reconnects with the same token/identity
	connA2, snap2 := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	defer connA2.CloseNow()

	var snapPayload2 snapshotPayload
	_ = json.Unmarshal(snap2.Payload, &snapPayload2)

	// The reconnected participant must preserve original connection ID & JoinedAt
	if snapPayload2.Self.ConnectionID != originalConnectionID {
		t.Fatalf("reconnect changed connection ID: got %s, want %s", snapPayload2.Self.ConnectionID, originalConnectionID)
	}
	if !snapPayload2.Self.JoinedAt.Equal(snapPayload1.Self.JoinedAt) {
		t.Fatalf("reconnect changed JoinedAt timestamp")
	}

	// Ensure there are no duplicate participants in snapshot
	aliceCount := 0
	for _, p := range snapPayload2.Participants {
		if p.DisplayName == "Alice" {
			aliceCount++
		}
	}
	if aliceCount != 1 {
		t.Fatalf("expected exactly 1 Alice in participants, got %d", aliceCount)
	}

	// Wait 400ms (longer than original grace period would have been)
	time.Sleep(400 * time.Millisecond)

	// Bob should NOT receive participant.left because Alice reconnected in time
	readCtx, readCancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer readCancel()
	var unexpected Envelope
	if err := wsjson.Read(readCtx, connB, &unexpected); err == nil && unexpected.Type == "participant.left" {
		t.Fatalf("bob received unexpected participant.left for reconnected alice: %s", unexpected.Type)
	}

	// Total clients in room should be 2 (Alice and Bob)
	hub.mu.RLock()
	clientCount := len(hub.rooms[room.ID].clients)
	hub.mu.RUnlock()
	if clientCount != 2 {
		t.Fatalf("expected 2 clients in room, got %d", clientCount)
	}
}

func TestReconnectAfterTimeout(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetDisconnectGracePeriod(50 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connA1, _ := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	_ = connA1.CloseNow()

	// Wait for grace period to expire
	time.Sleep(100 * time.Millisecond)

	// Alice reconnects after grace period has expired
	connA2, snap2 := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	defer connA2.CloseNow()

	if snap2.Type != "room.snapshot" {
		t.Fatalf("expected room.snapshot after reconnect, got %s", snap2.Type)
	}

	hub.mu.RLock()
	clientCount := len(hub.rooms[room.ID].clients)
	hub.mu.RUnlock()
	if clientCount != 1 {
		t.Fatalf("expected 1 client in room, got %d", clientCount)
	}
}

func TestDuplicateTabRejectionWhileActive(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// First tab connects
	connA1, _ := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	defer connA1.CloseNow()

	// Second tab connects while first tab is STILL ACTIVE
	connA2, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}},
	})
	if err != nil {
		t.Fatalf("dial tab 2: %v", err)
	}
	defer connA2.CloseNow()

	payload, _ := json.Marshal(authPayload{Token: tokenA, RoomID: room.ID})
	_ = wsjson.Write(ctx, connA2, Envelope{Type: "connection.auth", Version: 1, Payload: payload})

	var denied Envelope
	if err := wsjson.Read(ctx, connA2, &denied); err != nil {
		t.Fatalf("read tab 2 error: %v", err)
	}

	var reason errorPayload
	_ = json.Unmarshal(denied.Payload, &reason)
	if denied.Type != "error" || reason.Code != "DUPLICATE_SESSION" {
		t.Fatalf("expected DUPLICATE_SESSION error for simultaneous active tab, got: %s %s", denied.Type, reason.Code)
	}

	// First tab remains active and operational
	if err := wsjson.Write(ctx, connA1, Envelope{Type: "connection.ping", Version: 1}); err != nil {
		t.Fatalf("first tab failed ping: %v", err)
	}
	var pong Envelope
	if err := wsjson.Read(ctx, connA1, &pong); err != nil || pong.Type != "connection.pong" {
		t.Fatalf("first tab failed pong: %v", err)
	}
}

func TestHeartbeatTimeoutDetection(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	tokenA, _, _, _ := guests.Issue(room.ID, "Alice")

	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Idle timeout 50ms, grace period 50ms
	hub.SetIdleTimeout(50 * time.Millisecond)
	hub.SetDisconnectGracePeriod(50 * time.Millisecond)

	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connA, _ := dialRealtimeClient(t, ctx, server.URL, tokenA, room.ID)
	defer connA.CloseNow()

	// Stop sending any pings/messages from client (simulating network freeze/crash)
	// Server idle timeout (50ms) + grace period (50ms) = 100ms total
	time.Sleep(150 * time.Millisecond)

	hub.mu.RLock()
	clients := hub.rooms[room.ID].clients
	hub.mu.RUnlock()
	if len(clients) != 0 {
		t.Fatalf("expected stale client to be removed after idle + grace period, got %d", len(clients))
	}
}
