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
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
)

type realtimeStore struct{ room domain.Room }

func (s *realtimeStore) UpdateRoomAppearanceByHost(_ context.Context, roomID string, expectedVersion int64, update domain.RoomAppearanceUpdate) (domain.Room, error) {
	if s.room.ID != roomID || s.room.Version != expectedVersion {
		return domain.Room{}, domain.ErrConflict
	}
	if !update.Atmosphere.Valid() || !update.Accent.Valid() {
		return domain.Room{}, domain.ErrInvalidRoomAppearance
	}
	s.room.Atmosphere, s.room.Accent, s.room.AdaptiveMediaBackground = update.Atmosphere, update.Accent, update.AdaptiveMediaBackground
	s.room.Version++
	return s.room, nil
}

type governedRealtimeStore struct {
	realtimeStore
	mu   sync.Mutex
	bans map[string]struct{}
}

func (s *governedRealtimeStore) GetRoom(_ context.Context, identifier string) (domain.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room.ID == identifier || s.room.Slug == identifier {
		return s.room, nil
	}
	return domain.Room{}, domain.ErrNotFound
}

func (s *governedRealtimeStore) SetRoomLocked(_ context.Context, roomID, ownerID string, expectedVersion int64, locked bool) (domain.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room.ID != roomID || s.room.OwnerID != ownerID || s.room.Version != expectedVersion {
		return domain.Room{}, domain.ErrConflict
	}
	s.room.IsLocked = locked
	s.room.Version++
	return s.room, nil
}

func (s *governedRealtimeStore) BanIdentity(_ context.Context, roomID, ownerID string, identity domain.Identity) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room.ID != roomID || s.room.OwnerID != ownerID {
		return domain.ErrConflict
	}
	key := identity.LiveKitIdentity()
	if _, exists := s.bans[key]; exists {
		return domain.ErrConflict
	}
	s.bans[key] = struct{}{}
	return nil
}

func (s *governedRealtimeStore) IsBanned(_ context.Context, roomID string, identity domain.Identity) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.room.ID != roomID {
		return false, domain.ErrNotFound
	}
	_, exists := s.bans[identity.LiveKitIdentity()]
	return exists, nil
}

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

func TestRemoteAppearanceAppliesOnlyNewerValidState(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Version: 3, Atmosphere: domain.AtmosphereAmbient, Accent: domain.AccentBlue}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}}
	hub.DeliverRemote(room.ID, event("room.appearance.updated", room.ID, roomAppearanceUpdatedPayload{domain.AtmosphereParty, domain.AccentRose, false, 4}))
	if got := hub.rooms[room.ID].room; got.Version != 4 || got.Atmosphere != domain.AtmosphereParty || got.Accent != domain.AccentRose {
		t.Fatalf("new appearance not applied: %+v", got)
	}
	hub.DeliverRemote(room.ID, event("room.appearance.updated", room.ID, roomAppearanceUpdatedPayload{domain.RoomAtmosphere("<style>"), domain.AccentGreen, true, 5}))
	if got := hub.rooms[room.ID].room; got.Version != 4 {
		t.Fatalf("invalid appearance applied: %+v", got)
	}
}

func TestHostTransferAndGraceFailover(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), OwnerID: "owner", AllowGuests: true, MaxParticipants: 4}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetDisconnectGracePeriod(15 * time.Millisecond)
	owner := &client{id: "socket-owner", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: domain.Identity{ID: "owner", Type: domain.IdentityUser}}
	member := &client{id: "socket-member", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: domain.Identity{ID: "member", Type: domain.IdentityUser}}
	if _, _, ok := hub.add(owner, room); !ok {
		t.Fatal("owner was not admitted")
	}
	if _, _, ok := hub.add(member, room); !ok {
		t.Fatal("member was not admitted")
	}
	hub.mu.Lock()
	state := hub.rooms[room.ID]
	if state.host.ConnectionID != owner.participant.ConnectionID || owner.participant.Role != "host" {
		hub.mu.Unlock()
		t.Fatalf("owner was not selected as host: %+v", state.host)
	}
	transferEvent := setHostLocked(state, member.participant, member.generation, "connected", "transfer")
	hub.mu.Unlock()
	if len(transferEvent) == 0 || member.participant.Role != "host" || owner.participant.Role == "host" {
		t.Fatal("host transfer did not revoke the old host")
	}
	hub.remove(member)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if host := hub.hostAuthority(room.ID); host.ConnectionID == owner.participant.ConnectionID && host.State == "connected" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if host := hub.hostAuthority(room.ID); host.ConnectionID != owner.participant.ConnectionID || host.State != "connected" {
		t.Fatalf("expected deterministic failover to owner, got %+v", host)
	}
}

func TestRemoteHostEventConverges(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), OwnerID: "owner", AllowGuests: true, MaxParticipants: 4}
	first := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	second := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	remoteClient := &client{id: "a-remote", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: domain.Identity{ID: "member", Type: domain.IdentityUser}}
	if _, _, ok := second.add(remoteClient, room); !ok {
		t.Fatal("remote participant was not admitted")
	}
	ownerClient := &client{id: "z-owner", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: domain.Identity{ID: "owner", Type: domain.IdentityUser}}
	if _, _, ok := first.add(ownerClient, room); !ok {
		t.Fatal("owner was not admitted")
	}
	first.mu.RLock()
	authority := first.rooms[room.ID].host
	first.mu.RUnlock()
	second.DeliverRemote(room.ID, hostEvent(room.ID, authority, "initial"))
	if got := second.hostAuthority(room.ID); got.ConnectionID != authority.ConnectionID || got.IdentityID != authority.IdentityID {
		t.Fatalf("remote host state did not converge: got %+v want %+v", got, authority)
	}
	if remoteClient.participant.Role == "host" {
		t.Fatal("remote participant retained stale host role")
	}
}

func TestTemporaryBanExpiresInLocalAdmission(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 4}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	identity := domain.Identity{ID: "guest-1", Type: domain.IdentityGuest, RoomID: room.ID}
	first := &client{id: "guest-1", roomID: room.ID, identity: identity, send: make(chan []byte, outboundCapacity)}
	hub.mu.Lock()
	state := &roomState{clients: make(map[string]*client), kicked: make(map[string]struct{}), temporaryBans: map[string]time.Time{identity.LiveKitIdentity(): time.Now().UTC().Add(time.Minute)}, room: room}
	hub.rooms[room.ID] = state
	hub.mu.Unlock()
	if _, _, ok := hub.add(first, room); ok || first.joinError != "ROOM_TEMPORARILY_BANNED" {
		t.Fatalf("active temporary ban did not reject admission: ok=%v error=%s", ok, first.joinError)
	}
	hub.mu.Lock()
	state.temporaryBans[identity.LiveKitIdentity()] = time.Now().UTC().Add(-time.Second)
	hub.mu.Unlock()
	second := &client{id: "guest-2", roomID: room.ID, identity: identity, send: make(chan []byte, outboundCapacity)}
	if _, _, ok := hub.add(second, room); !ok {
		t.Fatalf("expired temporary ban still blocked admission: %s", second.joinError)
	}
}

func TestReconnectPreservesHandAndRemoteNewerVersionWins(t *testing.T) {
	room := domain.Room{ID: "social-room", AllowGuests: true, MaxParticipants: 4}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	first := &client{id: "socket-a", tabSessionID: "tab", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: domain.Identity{ID: "member", Type: domain.IdentityUser}}
	if _, _, ok := hub.add(first, room); !ok {
		t.Fatal("first connection not admitted")
	}
	first.participant.RaisedHand = true
	first.participant.SocialVersion = 2
	first.disconnected = true
	second := &client{id: "socket-b", tabSessionID: "tab", roomID: room.ID, send: make(chan []byte, outboundCapacity), identity: first.identity}
	if _, _, ok := hub.add(second, room); !ok {
		t.Fatalf("reconnect not admitted: %s", second.joinError)
	}
	if !second.participant.RaisedHand || second.participant.SocialVersion != 2 {
		t.Fatalf("social state not restored: %+v", second.participant)
	}
	hub.DeliverRemote(room.ID, event("participant.hand_changed", room.ID, handChangedPayload{
		ConnectionID: second.participant.ConnectionID, IdentityID: "member", Raised: false, SocialVersion: 3,
	}))
	if second.participant.RaisedHand || second.participant.SocialVersion != 3 {
		t.Fatalf("newer remote hand state not applied: %+v", second.participant)
	}
	hub.DeliverRemote(room.ID, event("participant.hand_changed", room.ID, handChangedPayload{
		ConnectionID: second.participant.ConnectionID, IdentityID: "member", Raised: true, SocialVersion: 2,
	}))
	if second.participant.RaisedHand || second.participant.SocialVersion != 3 {
		t.Fatalf("stale remote hand state applied: %+v", second.participant)
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

func TestLockedRoomAllowsSameTabGuestReconnect(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	identity := domain.Identity{ID: uuid.NewString(), Type: domain.IdentityGuest, RoomID: room.ID, DisplayName: "Guest"}
	first := &client{id: uuid.NewString(), tabSessionID: "tab-1", roomID: room.ID, identity: identity}
	if _, _, added := hub.add(first, room); !added {
		t.Fatal("initial guest could not join")
	}
	hub.mu.Lock()
	hub.rooms[room.ID].room.IsLocked = true
	first.disconnected = true
	hub.mu.Unlock()
	reconnect := &client{id: uuid.NewString(), tabSessionID: "tab-1", roomID: room.ID, identity: identity}
	if _, _, added := hub.add(reconnect, room); !added {
		t.Fatalf("same-tab reconnect was blocked: %s", reconnect.joinError)
	}
	newGuest := identity
	newGuest.ID = uuid.NewString()
	blocked := &client{id: uuid.NewString(), tabSessionID: "tab-2", roomID: room.ID, identity: newGuest}
	if _, _, added := hub.add(blocked, room); added || blocked.joinError != "ROOM_LOCKED" {
		t.Fatalf("new guest was not blocked by lock: added=%v error=%s", added, blocked.joinError)
	}
}

func TestRoomLockAndParticipantKick(t *testing.T) {
	const (
		secret  = "12345678901234567890123456789012"
		ownerID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	)
	room := domain.Room{ID: uuid.NewString(), OwnerID: ownerID, AllowGuests: true, MaxParticipants: 3}
	store := &governedRealtimeStore{realtimeStore: realtimeStore{room: room}, bans: make(map[string]struct{})}
	users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)
	guests := auth.NewGuestTokens(secret, time.Hour)
	guestToken, guestIdentity, _, err := guests.Issue(room.ID, "Guest")
	if err != nil {
		t.Fatal(err)
	}
	hostToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": ownerID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	hub := New(store, guests, users, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dial := func(token string) (*websocket.Conn, Envelope) {
		t.Helper()
		conn, _, dialErr := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
		if dialErr != nil {
			t.Fatal(dialErr)
		}
		payload, _ := json.Marshal(authPayload{Token: token, RoomID: room.ID, TabSessionID: uuid.NewString()})
		if writeErr := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, RoomID: room.ID, Payload: payload}); writeErr != nil {
			t.Fatal(writeErr)
		}
		var snapshot Envelope
		if readErr := wsjson.Read(ctx, conn, &snapshot); readErr != nil {
			t.Fatal(readErr)
		}
		return conn, snapshot
	}
	host, hostSnapshot := dial(hostToken)
	defer host.CloseNow()
	if hostSnapshot.Type != "room.snapshot" {
		t.Fatalf("host join failed: %s", hostSnapshot.Type)
	}
	guest, guestSnapshot := dial(guestToken)
	defer guest.CloseNow()
	if guestSnapshot.Type != "room.snapshot" {
		t.Fatalf("guest join failed: %s", guestSnapshot.Type)
	}
	var snapshotPayload struct {
		Self domain.Participant `json:"self"`
	}
	if err := json.Unmarshal(guestSnapshot.Payload, &snapshotPayload); err != nil {
		t.Fatal(err)
	}
	guestParticipant := snapshotPayload.Self
	var joined Envelope
	if err := wsjson.Read(ctx, host, &joined); err != nil || joined.Type != "participant.joined" {
		t.Fatalf("host did not observe guest join: type=%s err=%v", joined.Type, err)
	}
	lockData, _ := json.Marshal(roomLockPayload{Locked: true, ExpectedVersion: 0})
	if err := wsjson.Write(ctx, host, Envelope{Type: "room.lock", Version: 1, RoomID: room.ID, Payload: lockData}); err != nil {
		t.Fatal(err)
	}
	var lockEvent Envelope
	if err := wsjson.Read(ctx, host, &lockEvent); err != nil || lockEvent.Type != "room.locked" {
		t.Fatalf("host did not observe room lock: type=%s err=%v", lockEvent.Type, err)
	}
	var lockPayload roomLockedPayload
	if err := json.Unmarshal(lockEvent.Payload, &lockPayload); err != nil || !lockPayload.Locked || lockPayload.Version != 1 {
		t.Fatalf("room lock state was not committed: payload=%s", lockEvent.Payload)
	}
	var guestLock Envelope
	if err := wsjson.Read(ctx, guest, &guestLock); err != nil || guestLock.Type != "room.locked" {
		t.Fatalf("guest did not receive room lock: type=%s err=%v", guestLock.Type, err)
	}
	// Presence can briefly retain a participant's former display role after a
	// host hand-off. Moderation must use the active host authority, not this
	// replicated presentation field.
	hub.mu.Lock()
	for _, client := range hub.rooms[room.ID].clients {
		if client.participant.ConnectionID == guestParticipant.ConnectionID {
			client.participant.Role = "host"
		}
	}
	hub.mu.Unlock()
	kickPayload, _ := json.Marshal(kickPayload{ConnectionID: guestParticipant.ConnectionID})
	if err := wsjson.Write(ctx, host, Envelope{Type: "participant.kick", Version: 1, RoomID: room.ID, Payload: kickPayload}); err != nil {
		t.Fatal(err)
	}
	var left Envelope
	if err := wsjson.Read(ctx, host, &left); err != nil || left.Type != "participant.left" {
		t.Fatalf("host did not observe kick: type=%s err=%v", left.Type, err)
	}
	var leftPayload struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(left.Payload, &leftPayload); err != nil || leftPayload.ConnectionID != guestParticipant.ConnectionID {
		t.Fatalf("wrong kicked participant: payload=%s", left.Payload)
	}
	var ignored Envelope
	if err := wsjson.Read(ctx, guest, &ignored); err == nil {
		t.Fatal("kicked guest websocket remained open")
	}
	if banned, _ := store.IsBanned(ctx, room.ID, guestIdentity); !banned {
		t.Fatal("kick did not persist a ban")
	}
	reconnected, reconnectResponse := dial(guestToken)
	defer reconnected.CloseNow()
	var rejection errorPayload
	if err := json.Unmarshal(reconnectResponse.Payload, &rejection); err != nil || reconnectResponse.Type != "error" || rejection.Code != "ROOM_KICKED" {
		t.Fatalf("banned guest was allowed to reconnect: type=%s payload=%s", reconnectResponse.Type, reconnectResponse.Payload)
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

func TestSocialCommandsValidateAndPublishCurrentState(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), AllowGuests: true, MaxParticipants: 4}
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
	authData, _ := json.Marshal(authPayload{Token: raw, RoomID: room.ID, TabSessionID: "tab-social"})
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: authData}); err != nil {
		t.Fatal(err)
	}
	var snapshot Envelope
	if err := wsjson.Read(ctx, conn, &snapshot); err != nil || snapshot.Type != "room.snapshot" {
		t.Fatalf("snapshot: %s %v", snapshot.Type, err)
	}

	if err := wsjson.Write(ctx, conn, Envelope{Type: "reaction.send", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: json.RawMessage(`{"emoji":"👍"}`)}); err != nil {
		t.Fatal(err)
	}
	var rejected Envelope
	if err := wsjson.Read(ctx, conn, &rejected); err != nil || rejected.Type != "error" {
		t.Fatalf("retired reaction was not rejected: %s %v", rejected.Type, err)
	}

	if err := wsjson.Write(ctx, conn, Envelope{Type: "participant.hand.set", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: json.RawMessage(`{"raised":true,"expected_social_version":0}`)}); err != nil {
		t.Fatal(err)
	}
	var hand Envelope
	if err := wsjson.Read(ctx, conn, &hand); err != nil || hand.Type != "participant.hand_changed" {
		t.Fatalf("hand event: %s %v", hand.Type, err)
	}
	var handPayload handChangedPayload
	if err := json.Unmarshal(hand.Payload, &handPayload); err != nil || !handPayload.Raised || handPayload.SocialVersion != 1 {
		t.Fatalf("invalid hand fact: %+v %v", handPayload, err)
	}

	if err := wsjson.Write(ctx, conn, Envelope{Type: "wave.send", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	var wave Envelope
	if err := wsjson.Read(ctx, conn, &wave); err != nil || wave.Type != "wave.sent" {
		t.Fatalf("wave event: %s %v", wave.Type, err)
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

func TestRoomAppearanceRealtimeWorkflow(t *testing.T) {
	ownerID := uuid.NewString()
	memberID := uuid.NewString()
	room := domain.Room{ID: uuid.NewString(), OwnerID: ownerID, AllowGuests: true, MaxParticipants: 4, Version: 0}
	room = domain.NormalizeRoomAppearance(room)
	store := &realtimeStore{room: room}
	secret := "12345678901234567890123456789012"
	guests := auth.NewGuestTokens(secret, time.Hour)
	users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", secret)

	guestToken, _, _, err := guests.Issue(room.ID, "Guest Alice")
	if err != nil {
		t.Fatal(err)
	}
	hostToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": ownerID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": memberID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	hub := New(store, guests, users, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.SetDisconnectGracePeriod(50 * time.Millisecond)
	server := httptest.NewServer(hub)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dial := func(token string) (*websocket.Conn, Envelope) {
		t.Helper()
		conn, _, dialErr := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}}})
		if dialErr != nil {
			t.Fatal(dialErr)
		}
		payload, _ := json.Marshal(authPayload{Token: token, RoomID: room.ID, TabSessionID: uuid.NewString()})
		if writeErr := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, RoomID: room.ID, Payload: payload}); writeErr != nil {
			t.Fatal(writeErr)
		}
		var snapshot Envelope
		if readErr := wsjson.Read(ctx, conn, &snapshot); readErr != nil {
			t.Fatal(readErr)
		}
		return conn, snapshot
	}

	hostConn, hostSnap := dial(hostToken)
	defer hostConn.CloseNow()

	guestConn, guestSnap := dial(guestToken)
	defer guestConn.CloseNow()

	// 1. Verify snapshot appearance
	var snapPayload struct {
		Room domain.Room `json:"room"`
	}
	if err := json.Unmarshal(hostSnap.Payload, &snapPayload); err != nil {
		t.Fatalf("unmarshaling snapshot: %v", err)
	}
	if snapPayload.Room.Atmosphere != domain.AtmosphereAmbient || snapPayload.Room.Accent != domain.AccentBlue || !snapPayload.Room.AdaptiveMediaBackground {
		t.Fatalf("unexpected snapshot appearance: %+v", snapPayload.Room)
	}

	var guestSnapPayload struct {
		Room domain.Room `json:"room"`
	}
	if err := json.Unmarshal(guestSnap.Payload, &guestSnapPayload); err != nil {
		t.Fatalf("unmarshaling guest snapshot: %v", err)
	}
	if guestSnapPayload.Room.Atmosphere != domain.AtmosphereAmbient || guestSnapPayload.Room.Accent != domain.AccentBlue || !guestSnapPayload.Room.AdaptiveMediaBackground {
		t.Fatalf("unexpected guest snapshot appearance: %+v", guestSnapPayload.Room)
	}

	// Drain participant.joined on hostConn
	var eventEnv Envelope
	if err := wsjson.Read(ctx, hostConn, &eventEnv); err != nil || eventEnv.Type != "participant.joined" {
		t.Fatalf("expected participant.joined on host: %s, err: %v", eventEnv.Type, err)
	}

	// 2. Guest attempts appearance update -> must be rejected
	guestCmd, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
		ExpectedVersion:         0,
	})
	if err := wsjson.Write(ctx, guestConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: guestCmd}); err != nil {
		t.Fatal(err)
	}
	var guestErr Envelope
	if err := wsjson.Read(ctx, guestConn, &guestErr); err != nil || guestErr.Type != "error" {
		t.Fatalf("expected error for guest update, got: %s %v", guestErr.Type, err)
	}
	var errPayload errorPayload
	if err := json.Unmarshal(guestErr.Payload, &errPayload); err != nil || errPayload.Code != "ROOM_COMMAND_REJECTED" {
		t.Fatalf("expected ROOM_COMMAND_REJECTED for guest, got: %+v", errPayload)
	}

	// 3. Host sends invalid JSON payload structure -> INVALID_PAYLOAD
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: json.RawMessage(`"not-an-object"`)}); err != nil {
		t.Fatal(err)
	}
	var invalidJsonErr Envelope
	if err := wsjson.Read(ctx, hostConn, &invalidJsonErr); err != nil || invalidJsonErr.Type != "error" {
		t.Fatalf("expected error for invalid JSON, got: %s", invalidJsonErr.Type)
	}
	if err := json.Unmarshal(invalidJsonErr.Payload, &errPayload); err != nil || errPayload.Code != "INVALID_PAYLOAD" {
		t.Fatalf("expected INVALID_PAYLOAD, got: %+v", errPayload)
	}

	// 4. Host sends invalid atmosphere/accent -> INVALID_ROOM_APPEARANCE
	badAtmoCmd, _ := json.Marshal(map[string]any{
		"atmosphere":                "<style>",
		"accent":                    "blue",
		"adaptive_media_background": true,
		"expected_version":          0,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: badAtmoCmd}); err != nil {
		t.Fatal(err)
	}
	var badAtmoErr Envelope
	if err := wsjson.Read(ctx, hostConn, &badAtmoErr); err != nil || badAtmoErr.Type != "error" {
		t.Fatalf("expected error for bad atmosphere, got: %s", badAtmoErr.Type)
	}
	if err := json.Unmarshal(badAtmoErr.Payload, &errPayload); err != nil || errPayload.Code != "INVALID_ROOM_APPEARANCE" {
		t.Fatalf("expected INVALID_ROOM_APPEARANCE, got: %+v", errPayload)
	}

	badAccentCmd, _ := json.Marshal(map[string]any{
		"atmosphere":                "ambient",
		"accent":                    "#FF0000",
		"adaptive_media_background": true,
		"expected_version":          0,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: badAccentCmd}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, hostConn, &badAtmoErr); err != nil || badAtmoErr.Type != "error" {
		t.Fatalf("expected error for bad accent, got: %s", badAtmoErr.Type)
	}
	if err := json.Unmarshal(badAtmoErr.Payload, &errPayload); err != nil || errPayload.Code != "INVALID_ROOM_APPEARANCE" {
		t.Fatalf("expected INVALID_ROOM_APPEARANCE, got: %+v", errPayload)
	}

	// 5. Host sends stale expected_version -> ROOM_VERSION_CONFLICT
	staleCmd, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
		ExpectedVersion:         99,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: staleCmd}); err != nil {
		t.Fatal(err)
	}
	var staleErr Envelope
	if err := wsjson.Read(ctx, hostConn, &staleErr); err != nil || staleErr.Type != "error" {
		t.Fatalf("expected error for stale version, got: %s", staleErr.Type)
	}
	if err := json.Unmarshal(staleErr.Payload, &errPayload); err != nil || errPayload.Code != "ROOM_VERSION_CONFLICT" {
		t.Fatalf("expected ROOM_VERSION_CONFLICT, got: %+v", errPayload)
	}

	// 6. Host sends valid update -> success event broadcast to host and guest
	validCmd, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereParty,
		Accent:                  domain.AccentRose,
		AdaptiveMediaBackground: false,
		ExpectedVersion:         0,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: validCmd}); err != nil {
		t.Fatal(err)
	}

	var hostUpdated Envelope
	if err := wsjson.Read(ctx, hostConn, &hostUpdated); err != nil || hostUpdated.Type != "room.appearance.updated" {
		t.Fatalf("expected room.appearance.updated on host, got: %s %v", hostUpdated.Type, err)
	}
	var guestUpdated Envelope
	if err := wsjson.Read(ctx, guestConn, &guestUpdated); err != nil || guestUpdated.Type != "room.appearance.updated" {
		t.Fatalf("expected room.appearance.updated on guest, got: %s %v", guestUpdated.Type, err)
	}

	var updatedPayload roomAppearanceUpdatedPayload
	if err := json.Unmarshal(hostUpdated.Payload, &updatedPayload); err != nil {
		t.Fatalf("unmarshaling updated payload: %v", err)
	}
	if updatedPayload.Atmosphere != domain.AtmosphereParty || updatedPayload.Accent != domain.AccentRose || updatedPayload.AdaptiveMediaBackground || updatedPayload.Version != 1 {
		t.Fatalf("unexpected updated payload: %+v", updatedPayload)
	}

	// 7. Test all 4 atmospheres and 5 accents
	atmospheres := []domain.RoomAtmosphere{domain.AtmosphereMinimal, domain.AtmosphereAmbient, domain.AtmosphereFocus, domain.AtmosphereParty}
	accents := []domain.RoomAccent{domain.AccentBlue, domain.AccentPurple, domain.AccentGreen, domain.AccentOrange, domain.AccentRose}

	currentVersion := int64(1)
	for i, atmo := range atmospheres {
		acc := accents[i%len(accents)]
		cmd, _ := json.Marshal(roomAppearanceUpdatePayload{
			Atmosphere:              atmo,
			Accent:                  acc,
			AdaptiveMediaBackground: true,
			ExpectedVersion:         currentVersion,
		})
		if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: cmd}); err != nil {
			t.Fatal(err)
		}
		if err := wsjson.Read(ctx, hostConn, &hostUpdated); err != nil || hostUpdated.Type != "room.appearance.updated" {
			t.Fatalf("expected room.appearance.updated for atmo=%s acc=%s, got: %s", atmo, acc, hostUpdated.Type)
		}
		_ = wsjson.Read(ctx, guestConn, &guestUpdated)
		currentVersion++
	}

	// 8. Host transfer test
	memberConn, memberSnap := dial(memberToken)
	defer memberConn.CloseNow()
	_ = wsjson.Read(ctx, hostConn, &eventEnv) // drain participant.joined
	_ = wsjson.Read(ctx, guestConn, &eventEnv)

	var memberSnapPayload struct {
		Self domain.Participant `json:"self"`
	}
	_ = json.Unmarshal(memberSnap.Payload, &memberSnapPayload)

	// Transfer host to member
	transferCmd, _ := json.Marshal(transferHostPayload{TargetConnectionID: memberSnapPayload.Self.ConnectionID})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "host.transfer", Version: 1, RoomID: room.ID, Payload: transferCmd}); err != nil {
		t.Fatal(err)
	}
	// Drain host.changed
	_ = wsjson.Read(ctx, hostConn, &eventEnv)
	_ = wsjson.Read(ctx, guestConn, &eventEnv)
	_ = wsjson.Read(ctx, memberConn, &eventEnv)

	// Former host attempts appearance update -> must be rejected
	formerHostCmd, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereMinimal,
		Accent:                  domain.AccentBlue,
		AdaptiveMediaBackground: true,
		ExpectedVersion:         currentVersion,
	})
	if err := wsjson.Write(ctx, hostConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: formerHostCmd}); err != nil {
		t.Fatal(err)
	}
	var formerHostErr Envelope
	if err := wsjson.Read(ctx, hostConn, &formerHostErr); err != nil || formerHostErr.Type != "error" {
		t.Fatalf("expected error for former host, got: %s", formerHostErr.Type)
	}

	// New host updates appearance -> succeeds!
	newHostCmd, _ := json.Marshal(roomAppearanceUpdatePayload{
		Atmosphere:              domain.AtmosphereFocus,
		Accent:                  domain.AccentGreen,
		AdaptiveMediaBackground: true,
		ExpectedVersion:         currentVersion,
	})
	if err := wsjson.Write(ctx, memberConn, Envelope{Type: "room.appearance.update", Version: 1, RoomID: room.ID, Payload: newHostCmd}); err != nil {
		t.Fatal(err)
	}
	var newHostUpdated Envelope
	if err := wsjson.Read(ctx, memberConn, &newHostUpdated); err != nil || newHostUpdated.Type != "room.appearance.updated" {
		t.Fatalf("expected success for new host, got: %s", newHostUpdated.Type)
	}
}

func TestConcurrentRoomAppearanceMutationsRace(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Version: 1, Atmosphere: domain.AtmosphereAmbient, Accent: domain.AccentBlue}
	hub := New(&realtimeStore{room: room}, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(v int64) {
			defer wg.Done()
			hub.DeliverRemote(room.ID, event("room.appearance.updated", room.ID, roomAppearanceUpdatedPayload{
				Atmosphere:              domain.AtmosphereParty,
				Accent:                  domain.AccentRose,
				AdaptiveMediaBackground: true,
				Version:                 v,
			}))
			_ = hub.roomSnapshot(room.ID, room)
		}(int64(i + 2))
	}
	wg.Wait()

	hub.mu.RLock()
	finalVersion := hub.rooms[room.ID].room.Version
	hub.mu.RUnlock()

	if finalVersion < 2 {
		t.Fatalf("expected version to advance, got %d", finalVersion)
	}
}
