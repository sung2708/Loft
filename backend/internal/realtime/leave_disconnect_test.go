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
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

func dialRealtimeClient(t *testing.T, ctx context.Context, serverURL, token, roomID string) (*websocket.Conn, Envelope) {
	return dialRealtimeClientWithTab(t, ctx, serverURL, token, roomID, "")
}

func dialRealtimeClientWithTab(t *testing.T, ctx context.Context, serverURL, token, roomID, tabSessionID string) (*websocket.Conn, Envelope) {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(serverURL, "http"), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}},
	})
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	payload, _ := json.Marshal(authPayload{Token: token, RoomID: roomID, TabSessionID: tabSessionID})
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

func TestReloadSessionReplacesActiveConnection(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 10}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, _ := guests.Issue(room.ID, "Alice")
	hub := New(&realtimeStore{room: room}, guests, nil, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tabSessionID := uuid.NewString()
	first, firstSnapshot := dialRealtimeClientWithTab(t, ctx, server.URL, token, room.ID, tabSessionID)
	defer first.CloseNow()
	second, secondSnapshot := dialRealtimeClientWithTab(t, ctx, server.URL, token, room.ID, tabSessionID)
	defer second.CloseNow()

	if firstSnapshot.Type != "room.snapshot" || secondSnapshot.Type != "room.snapshot" {
		t.Fatalf("reload did not receive a snapshot: first=%s second=%s", firstSnapshot.Type, secondSnapshot.Type)
	}
	var firstState, secondState snapshotPayload
	_ = json.Unmarshal(firstSnapshot.Payload, &firstState)
	_ = json.Unmarshal(secondSnapshot.Payload, &secondState)
	if secondState.Self.ConnectionID != firstState.Self.ConnectionID {
		t.Fatalf("reload changed participant connection id: got %s, want %s", secondState.Self.ConnectionID, firstState.Self.ConnectionID)
	}

	hub.mu.RLock()
	count := len(hub.rooms[room.ID].clients)
	hub.mu.RUnlock()
	if count != 1 {
		t.Fatalf("expected exactly one active client after reload, got %d", count)
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

	// Stop sending messages and observe under the Hub lock. Scheduling under the
	// race detector can exceed the nominal idle + grace duration.
	deadline := time.Now().Add(time.Second)
	for {
		hub.mu.RLock()
		clientCount := 0
		if state := hub.rooms[room.ID]; state != nil {
			clientCount = len(state.clients)
		}
		hub.mu.RUnlock()
		if clientCount == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected stale client to be removed after idle + grace period, got %d", clientCount)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestReconnectAndLateJoinReceiveCurrentAppearanceWithoutReplay(t *testing.T) {
	ownerID := uuid.NewString()
	room := domain.Room{ID: uuid.NewString(), OwnerID: ownerID, AllowGuests: true, MaxParticipants: 10, Version: 0}
	room = domain.NormalizeRoomAppearance(room)
	store := &realtimeStore{room: room}
	secret := "12345678901234567890123456789012"
	guests := auth.NewGuestTokens(secret, time.Hour)
	users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)

	hostToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": ownerID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	tokenBob, _, _, _ := guests.Issue(room.ID, "Bob")
	tokenCharlie, _, _, _ := guests.Issue(room.ID, "Charlie")

	hub := New(store, guests, users, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetDisconnectGracePeriod(50 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	hostConn, _ := dialRealtimeClient(t, ctx, server.URL, hostToken, room.ID)
	defer hostConn.CloseNow()

	bobConn, _ := dialRealtimeClient(t, ctx, server.URL, tokenBob, room.ID)

	var eventEnv Envelope
	// Host drains participant.joined for Bob
	if err := wsjson.Read(ctx, hostConn, &eventEnv); err != nil || eventEnv.Type != "participant.joined" {
		t.Fatalf("host expected participant.joined, got %v (%s)", err, eventEnv.Type)
	}

	// Host changes appearance to focus + orange
	cmd1, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereFocus,
		Accent:                  domain.AccentOrange,
		AdaptiveMediaBackground: true,
		ExpectedVersion:         0,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: cmd1}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, hostConn, &eventEnv); err != nil || eventEnv.Type != "room.appearance.updated" {
		t.Fatalf("host expected room.appearance.updated, got %v (%s)", err, eventEnv.Type)
	}
	if err := wsjson.Read(ctx, bobConn, &eventEnv); err != nil || eventEnv.Type != "room.appearance.updated" {
		t.Fatalf("bob expected room.appearance.updated, got %v (%s)", err, eventEnv.Type)
	}

	// Bob disconnects abruptly
	_ = bobConn.CloseNow()
	time.Sleep(80 * time.Millisecond) // Wait for grace period

	// Host drains participant.left
	if err := wsjson.Read(ctx, hostConn, &eventEnv); err != nil || eventEnv.Type != "participant.left" {
		t.Fatalf("host expected participant.left, got %v (%s)", err, eventEnv.Type)
	}

	// While Bob is disconnected, Host changes appearance to party + rose
	cmd2, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
		ExpectedVersion:         1,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: cmd2}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, hostConn, &eventEnv); err != nil || eventEnv.Type != "room.appearance.updated" {
		t.Fatalf("host expected room.appearance.updated for cmd2, got %v (%s)", err, eventEnv.Type)
	}

	// Bob reconnects with fresh connection
	bobReconnected, bobSnap := dialRealtimeClient(t, ctx, server.URL, tokenBob, room.ID)
	defer bobReconnected.CloseNow()

	if bobSnap.Type != "room.snapshot" {
		t.Fatalf("expected room.snapshot on reconnect, got: %s", bobSnap.Type)
	}
	var bobSnapData struct {
		Room domain.Room `json:"room"`
	}
	if err := json.Unmarshal(bobSnap.Payload, &bobSnapData); err != nil {
		t.Fatalf("unmarshaling bob snapshot: %v", err)
	}
	if bobSnapData.Room.Atmosphere != domain.AtmosphereParty || bobSnapData.Room.Accent != domain.AccentRose || bobSnapData.Room.AdaptiveMediaBackground || bobSnapData.Room.Version != 2 {
		t.Fatalf("reconnecting client did not recover latest appearance: %+v", bobSnapData.Room)
	}

	// Late-joiner Charlie connects for the first time
	charlieConn, charlieSnap := dialRealtimeClient(t, ctx, server.URL, tokenCharlie, room.ID)
	defer charlieConn.CloseNow()

	if charlieSnap.Type != "room.snapshot" {
		t.Fatalf("expected room.snapshot for late joiner, got: %s", charlieSnap.Type)
	}
	var charlieSnapData struct {
		Room domain.Room `json:"room"`
	}
	if err := json.Unmarshal(charlieSnap.Payload, &charlieSnapData); err != nil {
		t.Fatalf("unmarshaling charlie snapshot: %v", err)
	}
	if charlieSnapData.Room.Atmosphere != domain.AtmosphereParty || charlieSnapData.Room.Accent != domain.AccentRose || charlieSnapData.Room.AdaptiveMediaBackground || charlieSnapData.Room.Version != 2 {
		t.Fatalf("late-joining client did not receive current appearance: %+v", charlieSnapData.Room)
	}
}
