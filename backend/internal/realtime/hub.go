package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/ratelimit"
	"loft/backend/internal/telemetry"
)

const (
	protocolVersion  = 1
	outboundCapacity = 64
	maxEventBytes    = 16 << 10
)

type Envelope struct {
	Type    string          `json:"type"`
	Version int             `json:"version"`
	EventID string          `json:"event_id"`
	RoomID  string          `json:"room_id,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

type authPayload struct {
	Token        string `json:"token"`
	RoomID       string `json:"room_id"`
	TabSessionID string `json:"tab_session_id"`
}
type pingPayload struct {
	ClientTime int64 `json:"client_time"`
}
type pongPayload struct {
	ClientTime int64 `json:"client_time"`
	ServerTime int64 `json:"server_time"`
}
type chatPayload struct {
	Content string `json:"content"`
}
type reactionPayload struct {
	Emoji string `json:"emoji"`
}
type reactionEvent struct {
	ConnectionID string `json:"connection_id"`
	DisplayName  string `json:"display_name"`
	Emoji        string `json:"emoji"`
}
type roomLockPayload struct {
	Locked          bool  `json:"locked"`
	ExpectedVersion int64 `json:"expected_version"`
}
type kickPayload struct {
	ConnectionID string `json:"connection_id"`
}
type roomLockedPayload struct {
	Locked   bool   `json:"locked"`
	LockedBy string `json:"locked_by"`
	Version  int64  `json:"version"`
}
type snapshotPayload struct {
	Room         domain.Room          `json:"room"`
	Self         domain.Participant   `json:"self"`
	Participants []domain.Participant `json:"participants"`
	Messages     []domain.Message     `json:"messages"`
	Media        mediaState           `json:"media"`
}
type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type client struct {
	joinError         string
	id                string
	tabSessionID      string
	roomID            string
	identity          domain.Identity
	participant       domain.Participant
	conn              *websocket.Conn
	send              chan []byte
	explicitLeave     bool
	suppressLeave     bool
	admittedReconnect bool
	disconnected      bool
	isReconnect       bool
	generation        uint64
	graceTimer        *time.Timer
	replaced          *client
}

type roomState struct {
	clients       map[string]*client
	media         mediaState
	room          domain.Room
	evict         *time.Timer
	mediaTimer    *time.Timer
	reactionTimes []time.Time
	kicked        map[string]struct{}
	mediaOwner    bool
}

type Hub struct {
	closing               bool
	handlers              sync.WaitGroup
	cancels               map[string]context.CancelFunc
	idleTimeout           time.Duration
	disconnectGracePeriod time.Duration
	mu                    sync.RWMutex
	rooms                 map[string]*roomState
	deleting              map[string]struct{}
	store                 domain.Store
	guests                *auth.GuestTokens
	users                 *auth.SupabaseVerifier
	origins               map[string]struct{}
	logger                *slog.Logger
	connectionLimit       *ratelimit.Limiter
	mediaLimit            *ratelimit.Limiter
	queueLimit            *ratelimit.Limiter
	chatLimit             *ratelimit.Limiter
	reactionLimit         *ratelimit.Limiter
	bus                   roomBus
	evictor               participantEvictor
	connectionsAccepted   atomic.Uint64
	broadcasts            atomic.Uint64
	slowConsumers         atomic.Uint64
	broadcastDuration     telemetry.DurationHistogram
}

type roomBus interface {
	Publish(context.Context, string, []byte) error
}
type admissionBus interface {
	AdmitPresence(context.Context, string, string, string, string, domain.Participant, int, bool) (domain.Participant, error)
	ReleasePresence(context.Context, string, string, string) error
	ListPresence(context.Context, string) ([]domain.Participant, error)
	HasAdmission(context.Context, string, string) (bool, error)
	HasPresenceForTab(context.Context, string, string, string) (bool, error)
}
type presenceRoutingBus interface {
	FindPresenceByConnection(context.Context, string, string) (presenceLease, bool, error)
	PublishPresenceKick(context.Context, string, presenceKick) error
}
type mediaAuthority interface {
	MediaOwner(context.Context, string) (bool, string, error)
	LoadMedia(context.Context, string) (mediaState, bool, error)
	InitializeMedia(context.Context, string, mediaState) (bool, error)
	CommitMedia(context.Context, string, uint64, mediaState, []byte) error
	ForwardMedia(context.Context, string, string, string, json.RawMessage, domain.Identity) error
}
type mediaOwnerReleaser interface {
	ReleaseMediaOwner(context.Context, string) error
}
type participantEvictor interface {
	RemoveParticipant(context.Context, string, string) error
}

func New(store domain.Store, guests *auth.GuestTokens, users *auth.SupabaseVerifier, origins []string, logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	return &Hub{
		cancels:               make(map[string]context.CancelFunc),
		idleTimeout:           30 * time.Second,
		disconnectGracePeriod: 15 * time.Second,
		rooms:                 make(map[string]*roomState),
		deleting:              make(map[string]struct{}),
		store:                 store,
		guests:                guests,
		users:                 users,
		origins:               allowed,
		logger:                logger,
		connectionLimit:       ratelimit.New(20, time.Minute, 10),
		mediaLimit:            ratelimit.New(10, 10*time.Second, 10),
		queueLimit:            ratelimit.New(10, time.Minute, 10),
		chatLimit:             ratelimit.New(20, time.Minute, 5),
		reactionLimit:         ratelimit.New(30, time.Minute, 4),
	}
}

func (h *Hub) SetDisconnectGracePeriod(d time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.disconnectGracePeriod = d
}

func (h *Hub) SetIdleTimeout(d time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.idleTimeout = d
}

// SetBus attaches optional inter-node fan-out. It is intentionally optional so
// a credential-free local MVP deployment retains its existing single-node mode.
func (h *Hub) SetBus(bus roomBus) {
	h.mu.Lock()
	h.bus = bus
	h.mu.Unlock()
	if redisBus, ok := bus.(*RedisBus); ok {
		redisBus.SetMediaHandler(h.handleForwardedMedia)
		redisBus.SetPresenceReplacementHandler(h.handlePresenceReplacement)
		redisBus.SetPresenceKickHandler(h.handlePresenceKick)
	}
}

func (h *Hub) handlePresenceReplacement(replacement presenceReplacement) {
	var target *client
	h.mu.Lock()
	if state := h.rooms[replacement.RoomID]; state != nil {
		for _, candidate := range state.clients {
			if candidate.id == replacement.ConnectionID && candidate.identity.LiveKitIdentity() == replacement.Identity {
				candidate.explicitLeave = true
				candidate.suppressLeave = true
				target = candidate
				break
			}
		}
	}
	h.mu.Unlock()
	if target != nil {
		_ = target.conn.CloseNow()
	}
}

func (h *Hub) handlePresenceKick(kick presenceKick) {
	var target *client
	h.mu.Lock()
	if state := h.rooms[kick.RoomID]; state != nil {
		for _, candidate := range state.clients {
			if candidate.participant.ConnectionID == kick.ConnectionID && candidate.identity.LiveKitIdentity() == kick.Identity {
				candidate.explicitLeave = true
				target = candidate
				break
			}
		}
	}
	h.mu.Unlock()
	if target != nil {
		_ = target.conn.CloseNow()
	}
}

func (h *Hub) mediaAuthorityForRoom(roomID string) (mediaAuthority, bool) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	authority, ok := bus.(mediaAuthority)
	return authority, ok
}

// releaseMediaOwner drops a Redis media lease after a room leaves this Hub.
// The lease must not be held until its TTL when the room is evicted, otherwise
// another instance can be fenced out for the remainder of the TTL.
func (h *Hub) releaseMediaOwner(roomID string) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	releaser, ok := bus.(mediaOwnerReleaser)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := releaser.ReleaseMediaOwner(ctx, roomID); err != nil {
		h.logger.Warn("media owner release failed", "room_id", roomID, "error", err)
	}
}

// ensureMediaAuthority hydrates a local room from the short-lived Redis
// failover snapshot and records whether this instance owns the fenced writer.
// Redis remains a coordination/cache layer; the Hub is still the state machine.
func (h *Hub) ensureMediaAuthority(ctx context.Context, roomID string) error {
	authority, ok := h.mediaAuthorityForRoom(roomID)
	if !ok {
		h.mu.Lock()
		if state := h.rooms[roomID]; state != nil {
			state.mediaOwner = true
		}
		h.mu.Unlock()
		return nil
	}
	owner, _, err := authority.MediaOwner(ctx, roomID)
	if err != nil {
		// A Redis outage keeps this node usable as a single-node room. A later
		// successful lease check fences the writer before cross-node publish.
		h.mu.Lock()
		if state := h.rooms[roomID]; state != nil {
			state.mediaOwner = true
		}
		h.mu.Unlock()
		return err
	}
	loaded, exists, loadErr := authority.LoadMedia(ctx, roomID)
	if loadErr != nil {
		return loadErr
	}
	var current mediaState
	h.mu.Lock()
	state := h.rooms[roomID]
	if state != nil {
		state.mediaOwner = owner
		if exists && loaded.Version >= state.media.Version {
			state.media = loaded
		}
		current = state.media.snapshot()
	}
	h.mu.Unlock()
	if owner && !exists {
		_, err = authority.InitializeMedia(ctx, roomID, current)
	}
	return err
}

func (h *Hub) publishMediaState(ctx context.Context, roomID string, previous uint64, media mediaState) error {
	data := event("media.state", roomID, media)
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	if authority, ok := bus.(mediaAuthority); ok {
		commitCtx, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
		err := authority.CommitMedia(commitCtx, roomID, previous, media, data)
		cancel()
		if errors.Is(err, ErrMediaOwnerLost) || errors.Is(err, ErrMediaVersionChanged) {
			return err
		}
		if err != nil {
			h.logger.Warn("redis media commit failed; local state continues", "room_id", roomID, "error", err)
		}
	} else if bus != nil {
		publishCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		err := bus.Publish(publishCtx, roomID, data)
		cancel()
		// A Redis outage must not strand clients on this instance. The local
		// broadcast below still happens and the degraded path remains usable.
		if err != nil {
			h.logger.Warn("room event publish failed; local state continues", "room_id", roomID, "error", err)
		}
	}
	h.broadcasts.Add(1)
	h.broadcastLocal(roomID, data, "")
	return nil
}

// rollbackMediaState undoes an optimistic local mutation only when no later
// command has advanced the room. This keeps a fenced or stale Redis write from
// leaking an uncommitted snapshot to subsequent commands.
func (h *Hub) rollbackMediaState(roomID string, expectedVersion uint64, previous mediaState) {
	h.mu.Lock()
	if state := h.rooms[roomID]; state != nil && state.media.Version == expectedVersion {
		state.media = previous
		h.scheduleMediaEnd(roomID, state)
	}
	h.mu.Unlock()
}

func (h *Hub) handleForwardedMedia(ctx context.Context, request mediaRPCRequest) mediaRPCResponse {
	h.mu.Lock()
	state := h.rooms[request.RoomID]
	if state == nil {
		h.mu.Unlock()
		return mediaRPCResponse{RequestID: request.RequestID, Error: errMediaDenied.Error()}
	}
	previousState := state.media.snapshot()
	previous := state.media.Version
	err := state.media.applyMedia(request.Kind, request.Payload, state.room, request.Actor, time.Now().UTC())
	media := state.media.snapshot()
	if err == nil {
		h.scheduleMediaEnd(request.RoomID, state)
	}
	h.mu.Unlock()
	if err != nil {
		return mediaRPCResponse{RequestID: request.RequestID, Error: err.Error()}
	}
	if err := h.publishMediaState(ctx, request.RoomID, previous, media); err != nil {
		if errors.Is(err, ErrMediaOwnerLost) || errors.Is(err, ErrMediaVersionChanged) {
			h.rollbackMediaState(request.RoomID, media.Version, previousState)
		}
		return mediaRPCResponse{RequestID: request.RequestID, Error: err.Error()}
	}
	return mediaRPCResponse{RequestID: request.RequestID}
}

func (h *Hub) SetParticipantEvictor(evictor participantEvictor) {
	h.mu.Lock()
	h.evictor = evictor
	h.mu.Unlock()
}

func (h *Hub) roomSnapshot(roomID string, fallback domain.Room) domain.Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if state := h.rooms[roomID]; state != nil {
		return state.room
	}
	return fallback
}

// CanIssueMediaToken is checked by HTTP after WebSocket admission succeeds.
// Redis leases allow token requests routed to another backend instance.
func (h *Hub) CanIssueMediaToken(ctx context.Context, roomID string, identity domain.Identity) (bool, error) {
	h.mu.RLock()
	state := h.rooms[roomID]
	if state != nil {
		if _, banned := state.kicked[identity.LiveKitIdentity()]; banned {
			h.mu.RUnlock()
			return false, nil
		}
		for _, c := range state.clients {
			if !c.disconnected && c.identity.ID == identity.ID && c.identity.Type == identity.Type {
				h.mu.RUnlock()
				return true, nil
			}
		}
	}
	bus := h.bus
	h.mu.RUnlock()
	admissions, ok := bus.(admissionBus)
	if !ok {
		return false, nil
	}
	checkCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	return admissions.HasAdmission(checkCtx, roomID, identity.LiveKitIdentity())
}

func (h *Hub) PrometheusMetrics() string {
	return fmt.Sprintf("# TYPE loft_realtime_connections_accepted_total counter\nloft_realtime_connections_accepted_total %d\n# TYPE loft_realtime_broadcasts_total counter\nloft_realtime_broadcasts_total %d\n# TYPE loft_realtime_slow_consumers_total counter\nloft_realtime_slow_consumers_total %d\n", h.connectionsAccepted.Load(), h.broadcasts.Load(), h.slowConsumers.Load()) +
		h.broadcastDuration.Prometheus("loft_realtime_broadcast_duration_seconds", "Local room broadcast fan-out duration in seconds.")
}

// DeliverRemote is called by Redis after origin filtering. It reconciles the
// replicated media snapshot before local fan-out, and never republishes it.
func (h *Hub) DeliverRemote(roomID string, data []byte) {
	var envelope Envelope
	if json.Unmarshal(data, &envelope) == nil && envelope.Type == "media.state" {
		var incoming mediaState
		if json.Unmarshal(envelope.Payload, &incoming) == nil {
			h.mu.Lock()
			if state := h.rooms[roomID]; state != nil && incoming.Version > state.media.Version {
				state.media = incoming.snapshot()
				h.scheduleMediaEnd(roomID, state)
			}
			h.mu.Unlock()
		}
	}
	h.broadcastLocal(roomID, data, "")
}

// Shutdown rejects new handlers, cancels all existing handlers (including auth),
// and waits for their owned pumps before the caller closes the database.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	h.closing = true
	roomIDs := make([]string, 0, len(h.rooms))
	cancels := make([]context.CancelFunc, 0, len(h.cancels))
	for _, cancel := range h.cancels {
		cancels = append(cancels, cancel)
	}
	for roomID, room := range h.rooms {
		roomIDs = append(roomIDs, roomID)
		if room.evict != nil {
			room.evict.Stop()
		}
		if room.mediaTimer != nil {
			room.mediaTimer.Stop()
		}
		for _, c := range room.clients {
			if c.graceTimer != nil {
				c.graceTimer.Stop()
			}
		}
	}
	h.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	for _, roomID := range roomIDs {
		h.releaseMediaOwner(roomID)
	}
	done := make(chan struct{})
	go func() { h.handlers.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// BeginDelete atomically blocks new WebSocket joins while the database delete runs.
// Call FinishDelete on both success and failure; no I/O happens under h.mu.
func (h *Hub) BeginDelete(roomID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, busy := h.deleting[roomID]; busy {
		return false
	}
	if state := h.rooms[roomID]; state != nil && len(state.clients) > 0 {
		return false
	}
	h.deleting[roomID] = struct{}{}
	return true
}

func (h *Hub) FinishDelete(roomID string, deleted bool) {
	h.mu.Lock()
	if deleted {
		if state := h.rooms[roomID]; state != nil {
			if state.evict != nil {
				state.evict.Stop()
			}
			if state.mediaTimer != nil {
				state.mediaTimer.Stop()
			}
			for _, c := range state.clients {
				if c.graceTimer != nil {
					c.graceTimer.Stop()
				}
			}
		}
		delete(h.rooms, roomID)
	}
	delete(h.deleting, roomID)
	h.mu.Unlock()
	if deleted {
		h.releaseMediaOwner(roomID)
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithCancel(r.Context())
	handlerID := uuid.NewString()
	h.mu.Lock()
	if h.closing {
		h.mu.Unlock()
		cancel()
		http.Error(w, "server shutting down", http.StatusServiceUnavailable)
		return
	}
	h.handlers.Add(1)
	h.cancels[handlerID] = cancel
	h.mu.Unlock()
	defer func() {
		cancel()
		h.mu.Lock()
		delete(h.cancels, handlerID)
		h.mu.Unlock()
		h.handlers.Done()
	}()
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if !h.connectionLimit.AllowContext(ctx, host) {
		http.Error(w, "too many connection attempts", http.StatusTooManyRequests)
		return
	}
	if !h.originAllowed(r.Header.Get("Origin")) {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxEventBytes)
	defer conn.CloseNow()

	identity, room, tabSessionID, err := h.authenticate(ctx, conn)
	if err != nil {
		if errors.Is(err, domain.ErrBanned) {
			writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
			_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{"ROOM_KICKED", "Removed from room by host"}))
			stop()
		}
		_ = conn.Close(websocket.StatusPolicyViolation, "authentication failed")
		return
	}
	messages, err := h.store.RecentMessages(ctx, room.ID, 50)
	if err != nil {
		h.logger.Error("load chat snapshot", "room_id", room.ID, "error", err)
		return
	}
	role := "member"
	if identity.Type == domain.IdentityGuest {
		role = "guest"
	}
	if identity.Type == domain.IdentityUser && identity.ID == room.OwnerID {
		role = "host"
	}
	c := &client{
		id: uuid.NewString(), tabSessionID: tabSessionID, roomID: room.ID, identity: identity, conn: conn, send: make(chan []byte, outboundCapacity),
		participant: domain.Participant{ConnectionID: "", IdentityID: identity.ID, IdentityType: identity.Type, DisplayName: identity.DisplayName, AvatarURL: identity.AvatarURL, Role: role, LiveKitIdentity: identity.LiveKitIdentity(), JoinedAt: time.Now().UTC()},
	}
	c.participant.ConnectionID = c.id
	// Check local lifecycle gates before a cross-node replacement can mutate
	// the Redis lease. This avoids evicting an existing same-tab session when a
	// delete or room lock would reject the new WebSocket below.
	h.mu.RLock()
	deleting := false
	if _, ok := h.deleting[room.ID]; ok {
		deleting = true
	}
	locked := room.IsLocked
	if state := h.rooms[room.ID]; state != nil && state.room.IsLocked {
		locked = true
	}
	h.mu.RUnlock()
	lockedGuest := locked && identity.Type == domain.IdentityGuest
	if lockedGuest {
		// A room lock blocks new guest entries, but a guest reconnecting from
		// the same browser tab must retain its existing admission lease.
		reconnecting := false
		h.mu.RLock()
		if state := h.rooms[room.ID]; state != nil {
			for _, candidate := range state.clients {
				if candidate.identity.ID == identity.ID && candidate.identity.Type == identity.Type && candidate.tabSessionID == tabSessionID {
					reconnecting = true
					break
				}
			}
		}
		bus := h.bus
		h.mu.RUnlock()
		if !reconnecting {
			if presence, ok := bus.(interface {
				HasPresenceForTab(context.Context, string, string, string) (bool, error)
			}); ok {
				checkCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
				reconnecting, err = presence.HasPresenceForTab(checkCtx, room.ID, identity.LiveKitIdentity(), tabSessionID)
				cancel()
				if err != nil {
					h.logger.Warn("redis reconnect admission check failed", "room_id", room.ID, "error", err)
				}
			}
		}
		if !reconnecting {
			writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
			_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{"ROOM_LOCKED", "This room is locked"}))
			stop()
			return
		}
	}
	if deleting {
		code, message := "ROOM_UNAVAILABLE", "Room admission denied"
		writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{code, message}))
		stop()
		return
	}
	if err := h.admitPresence(ctx, c, room); err != nil {
		code := "ROOM_UNAVAILABLE"
		if errors.Is(err, ErrDistributedRoomFull) {
			code = "ROOM_FULL"
		} else if errors.Is(err, ErrDistributedDuplicateSession) {
			code = "DUPLICATE_SESSION"
		}
		writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{code, "Room admission denied"}))
		stop()
		return
	}
	participants, media, added := h.add(c, room)
	if !added {
		h.releasePresence(c)
		writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{c.joinError, "Room admission denied"}))
		stop()
		return
	}
	if c.replaced != nil {
		_ = c.replaced.conn.CloseNow()
	}
	if err := h.ensureMediaAuthority(ctx, room.ID); err != nil {
		h.logger.Warn("media authority unavailable; local state continues", "room_id", room.ID, "error", err)
	}
	h.mu.RLock()
	if state := h.rooms[room.ID]; state != nil {
		media = state.media.snapshot()
	}
	h.mu.RUnlock()
	h.connectionsAccepted.Add(1)
	defer h.remove(c)
	defer h.clearPresence(c)
	h.refreshPresence(ctx, c)
	participants = h.roomParticipants(ctx, room.ID, participants)

	writeDone := make(chan error, 1)
	var pumps sync.WaitGroup
	pumps.Add(1)
	go func() { defer pumps.Done(); writeDone <- h.writePump(ctx, c) }()
	defer func() { cancel(); _ = conn.CloseNow(); pumps.Wait() }()
	if !h.enqueue(c, event("room.snapshot", room.ID, snapshotPayload{Room: h.roomSnapshot(room.ID, room), Self: c.participant, Participants: participants, Messages: messages, Media: media})) {
		return
	}
	if !c.isReconnect {
		h.broadcast(room.ID, event("participant.joined", room.ID, c.participant), c.id)
		h.logger.Info("websocket joined", "connection_id", c.id, "room_id", room.ID, "identity_type", identity.Type)
	} else {
		h.logger.Info("websocket reconnected", "connection_id", c.id, "room_id", room.ID, "identity_type", identity.Type)
	}

	readDone := make(chan error, 1)
	pumps.Add(1)
	go func() { defer pumps.Done(); readDone <- h.readPump(ctx, c) }()
	select {
	case <-ctx.Done():
	case <-readDone:
	case <-writeDone:
	}
}

func (h *Hub) authenticate(ctx context.Context, conn *websocket.Conn) (domain.Identity, domain.Room, string, error) {
	authCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var envelope Envelope
	if err := wsjson.Read(authCtx, conn, &envelope); err != nil || envelope.Type != "connection.auth" || envelope.Version != protocolVersion {
		return domain.Identity{}, domain.Room{}, "", domain.ErrUnauthorized
	}
	var payload authPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil || payload.Token == "" || payload.RoomID == "" {
		return domain.Identity{}, domain.Room{}, "", domain.ErrUnauthorized
	}
	identity, err := h.guests.Verify(payload.Token)
	if err != nil {
		identity, err = h.users.Verify(authCtx, payload.Token)
	}
	if err != nil {
		return domain.Identity{}, domain.Room{}, "", err
	}
	room, err := h.store.GetRoom(authCtx, payload.RoomID)
	if err != nil || !domain.CanJoin(room, identity) {
		return domain.Identity{}, domain.Room{}, "", domain.ErrUnauthorized
	}
	if governance, ok := h.store.(domain.GovernanceStore); ok {
		banned, err := governance.IsBanned(authCtx, room.ID, identity)
		if err != nil {
			return domain.Identity{}, domain.Room{}, "", domain.ErrUnauthorized
		}
		if banned {
			return identity, room, payload.TabSessionID, domain.ErrBanned
		}
	}
	return identity, room, payload.TabSessionID, nil
}

func (h *Hub) readPump(ctx context.Context, c *client) error {
	for {
		var envelope Envelope
		readCtx, cancel := context.WithTimeout(ctx, h.idleTimeout)
		err := wsjson.Read(readCtx, c.conn, &envelope)
		cancel()
		if err != nil {
			return err
		}
		if envelope.Version != protocolVersion || (envelope.RoomID != "" && envelope.RoomID != c.roomID) {
			h.sendError(c, "INVALID_EVENT", "Invalid event envelope")
			continue
		}
		switch envelope.Type {
		case "room.leave":
			h.mu.Lock()
			c.explicitLeave = true
			h.mu.Unlock()
			_ = c.conn.Close(websocket.StatusNormalClosure, "left room")
			return nil
		case "room.lock":
			var payload roomLockPayload
			if json.Unmarshal(envelope.Payload, &payload) != nil || payload.ExpectedVersion < 0 {
				h.sendError(c, "INVALID_PAYLOAD", "Invalid room lock payload")
				continue
			}
			h.mu.RLock()
			state := h.rooms[c.roomID]
			allowed := state != nil && domain.CanChangeSettings(state.room, c.identity)
			h.mu.RUnlock()
			if !allowed {
				h.sendError(c, "ROOM_COMMAND_REJECTED", "room permission denied")
				continue
			}
			governance, ok := h.store.(domain.GovernanceStore)
			if !ok {
				h.sendError(c, "ROOM_COMMAND_REJECTED", "room governance unavailable")
				continue
			}
			updated, err := governance.SetRoomLocked(ctx, c.roomID, c.identity.ID, payload.ExpectedVersion, payload.Locked)
			if err != nil {
				h.logger.Warn("room lock rejected", "room_id", c.roomID, "connection_id", c.id, "locked", payload.Locked, "expected_version", payload.ExpectedVersion, "error", err)
				h.sendError(c, "ROOM_COMMAND_REJECTED", "room state changed; retry")
				continue
			}
			h.mu.Lock()
			if state := h.rooms[c.roomID]; state != nil && updated.Version > state.room.Version {
				state.room = updated
			}
			h.mu.Unlock()
			h.broadcast(c.roomID, event("room.locked", c.roomID, roomLockedPayload{updated.IsLocked, c.identity.ID, updated.Version}), "")
		case "participant.kick":
			var payload kickPayload
			if json.Unmarshal(envelope.Payload, &payload) != nil || payload.ConnectionID == "" {
				h.sendError(c, "INVALID_PAYLOAD", "Invalid participant target")
				continue
			}
			h.mu.RLock()
			state := h.rooms[c.roomID]
			allowed := state != nil && domain.CanKick(state.room, c.identity)
			var target *client
			if allowed {
				for _, candidate := range state.clients {
					if candidate.participant.ConnectionID == payload.ConnectionID {
						target = candidate
						break
					}
				}
			}
			bus := h.bus
			h.mu.RUnlock()
			if !allowed || target == c || (target != nil && target.participant.Role == "host") {
				h.sendError(c, "ROOM_COMMAND_REJECTED", "participant cannot be removed")
				continue
			}
			var targetIdentity domain.Identity
			targetInstance := ""
			if target != nil {
				targetIdentity = target.identity
			} else {
				routing, ok := bus.(presenceRoutingBus)
				if !ok {
					h.sendError(c, "ROOM_COMMAND_REJECTED", "participant cannot be removed")
					continue
				}
				lookupCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
				lease, found, lookupErr := routing.FindPresenceByConnection(lookupCtx, c.roomID, payload.ConnectionID)
				cancel()
				if lookupErr != nil || !found || lease.Participant.Role == "host" || lease.InstanceID == "" || lease.Participant.IdentityID == "" || (lease.Participant.IdentityType != domain.IdentityUser && lease.Participant.IdentityType != domain.IdentityGuest) {
					h.sendError(c, "ROOM_COMMAND_REJECTED", "participant cannot be removed")
					continue
				}
				targetIdentity = domain.Identity{ID: lease.Participant.IdentityID, Type: lease.Participant.IdentityType, DisplayName: lease.Participant.DisplayName, AvatarURL: lease.Participant.AvatarURL, RoomID: c.roomID}
				targetInstance = lease.InstanceID
			}
			governance, ok := h.store.(domain.GovernanceStore)
			if !ok {
				h.logger.Warn("participant kick rejected: governance store unavailable", "room_id", c.roomID, "connection_id", c.id)
				h.sendError(c, "ROOM_COMMAND_REJECTED", "participant could not be removed")
				continue
			}
			if err := governance.BanIdentity(ctx, c.roomID, c.identity.ID, targetIdentity); err != nil {
				h.logger.Warn("participant kick persistence failed", "room_id", c.roomID, "connection_id", c.id, "target_identity", targetIdentity.LiveKitIdentity(), "error", err)
				h.sendError(c, "ROOM_COMMAND_REJECTED", "participant could not be removed")
				continue
			}
			identityToRemove := targetIdentity.LiveKitIdentity()
			h.mu.Lock()
			evictor := h.evictor
			// Re-resolve the target after the durable ban write. The original
			// pointer may have disconnected or been replaced while the database
			// call was in flight; never close a stale socket by accident.
			target = nil
			if state := h.rooms[c.roomID]; state != nil {
				if state.kicked == nil {
					state.kicked = make(map[string]struct{})
				}
				state.kicked[identityToRemove] = struct{}{}
				for _, candidate := range state.clients {
					if candidate.participant.ConnectionID == payload.ConnectionID && candidate.identity.LiveKitIdentity() == identityToRemove {
						target = candidate
						target.explicitLeave = true
						break
					}
				}
			}
			h.mu.Unlock()
			// Socket and SFU I/O happen only after releasing the room mutex. A
			// kicked client may be slow or fully half-open, so never wait for a
			// close handshake here.
			if target != nil {
				_ = target.conn.CloseNow()
			} else if targetInstance != "" {
				routing, ok := bus.(presenceRoutingBus)
				if ok {
					kickCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
					if err := routing.PublishPresenceKick(kickCtx, targetInstance, presenceKick{RoomID: c.roomID, Identity: identityToRemove, ConnectionID: payload.ConnectionID}); err != nil {
						h.logger.Warn("remote participant kick notification failed", "room_id", c.roomID, "error", err)
					}
					cancel()
				}
				h.broadcast(c.roomID, event("participant.left", c.roomID, struct {
					ConnectionID string `json:"connection_id"`
				}{payload.ConnectionID}), "")
			}
			if evictor != nil {
				ejectCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
				connectionID := payload.ConnectionID
				if target != nil {
					connectionID = target.id
				}
				if err := evictor.RemoveParticipant(ejectCtx, c.roomID, identityToRemove); err != nil {
					h.logger.Warn("LiveKit participant removal failed", "room_id", c.roomID, "connection_id", connectionID, "error", err)
				}
				cancel()
			}
		case "connection.ping":
			var ping pingPayload
			_ = json.Unmarshal(envelope.Payload, &ping)
			h.enqueue(c, event("connection.pong", c.roomID, pongPayload{ping.ClientTime, time.Now().UnixMilli()}))
			h.refreshPresence(ctx, c)
		case "chat.send":
			key := c.roomID + ":" + c.identity.LiveKitIdentity()
			if !h.chatLimit.AllowContext(ctx, key) {
				h.sendError(c, "RATE_LIMITED", "Too many messages")
				continue
			}
			var payload chatPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				h.sendError(c, "INVALID_PAYLOAD", "Invalid chat payload")
				continue
			}
			content, err := domain.ValidateMessage(payload.Content)
			if err != nil {
				h.sendError(c, "INVALID_MESSAGE", "Message must be 1–2000 characters")
				continue
			}
			message, err := h.store.InsertMessage(ctx, c.roomID, c.identity, content)
			if err != nil {
				h.logger.Error("persist chat", "room_id", c.roomID, "connection_id", c.id, "error", err)
				h.sendError(c, "MESSAGE_SEND_FAILED", "Message could not be sent")
				continue
			}
			h.broadcast(c.roomID, event("chat.message", c.roomID, message), "")
		case "reaction.send":
			key := c.roomID + ":" + c.identity.LiveKitIdentity()
			if !h.reactionLimit.AllowContext(ctx, key) {
				h.sendError(c, "REACTION_RATE_LIMITED", "Too many reactions")
				continue
			}
			var payload reactionPayload
			if json.Unmarshal(envelope.Payload, &payload) != nil || !validReaction(payload.Emoji) {
				h.sendError(c, "INVALID_REACTION", "Unsupported reaction")
				continue
			}
			h.mu.Lock()
			state := h.rooms[c.roomID]
			allowed := state != nil && state.allowReaction(time.Now())
			h.mu.Unlock()
			if !allowed {
				h.sendError(c, "REACTION_RATE_LIMITED", "Room reactions are busy")
				continue
			}
			h.broadcastEphemeral(c.roomID, event("reaction.sent", c.roomID, reactionEvent{c.id, c.identity.DisplayName, payload.Emoji}))
		case "queue.add", "queue.next", "queue.select", "queue.remove", "queue.clear", "queue.shuffle", "queue.reorder", "media.play", "media.pause", "media.seek", "media.duration", "media.repeat":
			key := c.roomID + ":" + c.identity.LiveKitIdentity()
			limiter := h.mediaLimit
			if envelope.Type == "queue.add" || envelope.Type == "queue.remove" || envelope.Type == "queue.clear" || envelope.Type == "queue.shuffle" || envelope.Type == "queue.reorder" {
				limiter = h.queueLimit
			}
			if !limiter.AllowContext(ctx, key) {
				h.sendError(c, "MEDIA_RATE_LIMITED", "Too many media commands")
				continue
			}
			if authority, ok := h.mediaAuthorityForRoom(c.roomID); ok {
				owner, ownerID, ownerErr := authority.MediaOwner(ctx, c.roomID)
				if ownerErr == nil && !owner {
					forwardCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
					forwardErr := authority.ForwardMedia(forwardCtx, ownerID, c.roomID, envelope.Type, envelope.Payload, c.identity)
					cancel()
					if forwardErr != nil {
						h.sendError(c, "MEDIA_COMMAND_REJECTED", "Media authority is temporarily unavailable")
					}
					continue
				}
				if ownerErr != nil {
					h.logger.Warn("media owner lease unavailable; local state continues", "room_id", c.roomID, "error", ownerErr)
				}
			}
			h.mu.Lock()
			state := h.rooms[c.roomID]
			var applyErr error
			var media mediaState
			var previous uint64
			var previousState mediaState
			if state == nil {
				applyErr = errMediaDenied
			} else {
				previousState = state.media.snapshot()
				previous = state.media.Version
				applyErr = state.media.applyMedia(envelope.Type, envelope.Payload, state.room, c.identity, time.Now().UTC())
				media = state.media.snapshot()
				if applyErr == nil {
					h.scheduleMediaEnd(c.roomID, state)
				}
			}
			h.mu.Unlock()
			if applyErr != nil {
				h.sendError(c, "MEDIA_COMMAND_REJECTED", applyErr.Error())
				continue
			}
			if err := h.publishMediaState(ctx, c.roomID, previous, media); err != nil {
				if errors.Is(err, ErrMediaOwnerLost) || errors.Is(err, ErrMediaVersionChanged) {
					h.rollbackMediaState(c.roomID, media.Version, previousState)
				}
				h.sendError(c, "MEDIA_COMMAND_REJECTED", "Media authority changed; retry")
			}
		default:
			h.sendError(c, "UNKNOWN_EVENT", "Unsupported event type")
		}
	}
}

func (h *Hub) refreshPresence(parent context.Context, c *client) {
	h.mu.RLock()
	bus := h.bus
	state := h.rooms[c.roomID]
	active := state != nil && state.clients[c.id] == c && !c.disconnected
	limit := 12
	if state != nil && state.room.MaxParticipants > 0 {
		limit = state.room.MaxParticipants
	}
	h.mu.RUnlock()
	if !active {
		return
	}
	presence, ok := bus.(admissionBus)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
	defer cancel()
	_, err := presence.AdmitPresence(ctx, c.roomID, c.identity.LiveKitIdentity(), c.tabSessionID, c.id, c.participant, limit, false)
	if errors.Is(err, ErrDistributedDuplicateSession) || errors.Is(err, ErrDistributedRoomFull) || errors.Is(err, ErrDistributedStaleSession) {
		if errors.Is(err, ErrDistributedStaleSession) {
			h.mu.Lock()
			if state := h.rooms[c.roomID]; state != nil && state.clients[c.id] == c {
				c.explicitLeave = true
				c.suppressLeave = true
			}
			h.mu.Unlock()
		}
		_ = c.conn.CloseNow()
		return
	}
	if err != nil {
		h.logger.Warn("redis presence refresh failed; local presence continues", "room_id", c.roomID, "error", err)
	}
}

func (h *Hub) clearPresence(c *client) {
	h.mu.RLock()
	bus := h.bus
	clearNow := c.explicitLeave || h.closing || h.disconnectGracePeriod <= 0
	h.mu.RUnlock()
	if !clearNow {
		return // Keep the 15-second lease during the reconnect grace period.
	}
	presence, ok := bus.(admissionBus)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := presence.ReleasePresence(ctx, c.roomID, c.identity.LiveKitIdentity(), c.id); err != nil {
		h.logger.Warn("redis presence clear failed", "room_id", c.roomID, "error", err)
	}
}

func (h *Hub) releasePresence(c *client) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	presence, ok := bus.(admissionBus)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_ = presence.ReleasePresence(ctx, c.roomID, c.identity.LiveKitIdentity(), c.id)
}

func (h *Hub) admitPresence(parent context.Context, c *client, room domain.Room) error {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	presence, ok := bus.(admissionBus)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
	defer cancel()
	accepted, err := presence.AdmitPresence(ctx, room.ID, c.identity.LiveKitIdentity(), c.tabSessionID, c.id, c.participant, room.MaxParticipants, true)
	if err == nil {
		c.admittedReconnect = accepted.ConnectionID != c.id
		c.participant = accepted
		return nil
	}
	if errors.Is(err, ErrDistributedRoomFull) || errors.Is(err, ErrDistributedDuplicateSession) {
		return err
	}
	h.logger.Warn("redis admission unavailable; local room policy continues", "room_id", room.ID, "error", err)
	return nil
}

func (h *Hub) roomParticipants(parent context.Context, roomID string, local []domain.Participant) []domain.Participant {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	presence, ok := bus.(admissionBus)
	if !ok {
		return local
	}
	ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
	defer cancel()
	remote, err := presence.ListPresence(ctx, roomID)
	if err != nil {
		return local
	}
	byIdentity := make(map[string]domain.Participant, len(local)+len(remote))
	for _, participant := range local {
		byIdentity[participant.LiveKitIdentity] = participant
	}
	for _, participant := range remote {
		byIdentity[participant.LiveKitIdentity] = participant
	}
	all := make([]domain.Participant, 0, len(byIdentity))
	for _, participant := range byIdentity {
		all = append(all, participant)
	}
	slices.SortFunc(all, func(a, b domain.Participant) int { return a.JoinedAt.Compare(b.JoinedAt) })
	return all
}

func (h *Hub) writePump(ctx context.Context, c *client) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case data, ok := <-c.send:
			if !ok {
				return nil
			}
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.conn.Write(writeCtx, websocket.MessageText, data)
			cancel()
			if err != nil {
				return err
			}
		}
	}
}

func (h *Hub) add(c *client, room domain.Room) ([]domain.Participant, mediaState, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closing {
		c.joinError = "SERVER_SHUTTING_DOWN"
		return nil, mediaState{}, false
	}
	if _, deleting := h.deleting[c.roomID]; deleting {
		c.joinError = "ROOM_UNAVAILABLE"
		return nil, mediaState{}, false
	}
	state := h.rooms[c.roomID]
	if state == nil {
		state = &roomState{clients: make(map[string]*client), kicked: make(map[string]struct{}), mediaOwner: h.bus == nil, room: room, media: mediaState{Queue: []youtubeTrack{}, Status: "IDLE"}}
		h.rooms[c.roomID] = state
	}
	if room.Version > state.room.Version {
		state.room = room
	}
	if _, banned := state.kicked[c.identity.LiveKitIdentity()]; banned {
		c.joinError = "ROOM_KICKED"
		return nil, mediaState{}, false
	}
	var reconnectedFrom *client
	for _, existing := range state.clients {
		if existing.identity.ID == c.identity.ID && existing.identity.Type == c.identity.Type {
			if !existing.disconnected {
				if c.tabSessionID == "" || c.tabSessionID != existing.tabSessionID {
					c.joinError = "DUPLICATE_SESSION"
					return nil, mediaState{}, false
				}
			}
			reconnectedFrom = existing
			break
		}
	}
	if state.room.IsLocked && c.identity.Type == domain.IdentityGuest && reconnectedFrom == nil && !c.admittedReconnect {
		c.joinError = "ROOM_LOCKED"
		return nil, mediaState{}, false
	}
	limit := room.MaxParticipants
	if limit <= 0 {
		limit = 12
	}
	if len(state.clients) >= limit && reconnectedFrom == nil {
		c.joinError = "ROOM_FULL"
		return nil, mediaState{}, false
	}
	if state.evict != nil {
		state.evict.Stop()
		state.evict = nil
	}
	if reconnectedFrom != nil {
		c.isReconnect = true
		if reconnectedFrom.graceTimer != nil {
			reconnectedFrom.graceTimer.Stop()
			reconnectedFrom.graceTimer = nil
		}
		reconnectedFrom.generation++
		delete(state.clients, reconnectedFrom.id)
		if !reconnectedFrom.disconnected {
			c.replaced = reconnectedFrom
		}
		c.participant.ConnectionID = reconnectedFrom.participant.ConnectionID
		c.participant.JoinedAt = reconnectedFrom.participant.JoinedAt
		c.participant.Role = reconnectedFrom.participant.Role
	}
	state.clients[c.id] = c
	participants := make([]domain.Participant, 0, len(state.clients))
	for _, existing := range state.clients {
		participants = append(participants, existing.participant)
	}
	slices.SortFunc(participants, func(a, b domain.Participant) int { return a.JoinedAt.Compare(b.JoinedAt) })
	return participants, state.media.snapshot(), true
}

// scheduleMediaEnd runs under h.mu. The callback verifies room identity and
// version before changing state; it broadcasts only after releasing the lock.
func (h *Hub) scheduleMediaEnd(roomID string, state *roomState) {
	if state.mediaTimer != nil {
		state.mediaTimer.Stop()
		state.mediaTimer = nil
	}
	m := state.media
	if m.Current == nil || m.Status != "PLAYING" || m.Current.DurationSec <= 0 {
		return
	}
	remaining := time.Duration(m.Current.DurationSec*1000-m.PositionMs)*time.Millisecond - time.Since(m.StartedAt)
	if remaining < 0 {
		remaining = 0
	}
	version := m.Version
	state.mediaTimer = time.AfterFunc(remaining, func() {
		if authority, ok := h.mediaAuthorityForRoom(roomID); ok {
			checkCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			owner, _, err := authority.MediaOwner(checkCtx, roomID)
			cancel()
			if err == nil && !owner {
				h.mu.Lock()
				if h.rooms[roomID] == state {
					state.mediaOwner = false
				}
				h.mu.Unlock()
				return
			}
			if err == nil {
				h.mu.Lock()
				if h.rooms[roomID] == state {
					state.mediaOwner = true
				}
				h.mu.Unlock()
			}
		}
		h.mu.Lock()
		if h.closing || h.rooms[roomID] != state || state.media.Version != version || !state.mediaOwner {
			h.mu.Unlock()
			return
		}
		previousState := state.media.snapshot()
		if !state.media.finish(time.Now().UTC()) {
			h.scheduleMediaEnd(roomID, state)
			h.mu.Unlock()
			return
		}
		media := state.media.snapshot()
		previous := media.Version - 1
		h.scheduleMediaEnd(roomID, state)
		h.mu.Unlock()
		if err := h.publishMediaState(context.Background(), roomID, previous, media); err != nil {
			if errors.Is(err, ErrMediaOwnerLost) || errors.Is(err, ErrMediaVersionChanged) {
				h.rollbackMediaState(roomID, media.Version, previousState)
			}
			h.logger.Warn("media progression publish rejected", "room_id", roomID, "error", err)
		}
	})
}

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	state := h.rooms[c.roomID]
	if state == nil {
		h.mu.Unlock()
		return
	}

	existing, ok := state.clients[c.id]
	if !ok || existing != c {
		h.mu.Unlock()
		return
	}

	if c.explicitLeave || h.closing || h.disconnectGracePeriod <= 0 {
		suppressLeft := c.suppressLeave
		delete(state.clients, c.id)
		if c.graceTimer != nil {
			c.graceTimer.Stop()
			c.graceTimer = nil
		}
		if len(state.clients) == 0 && !h.closing {
			state.evict = time.AfterFunc(10*time.Minute, func() {
				released := false
				h.mu.Lock()
				if h.rooms[c.roomID] == state && len(state.clients) == 0 {
					if state.mediaTimer != nil {
						state.mediaTimer.Stop()
					}
					delete(h.rooms, c.roomID)
					released = true
				}
				h.mu.Unlock()
				if released {
					h.releaseMediaOwner(c.roomID)
				}
			})
		}
		h.mu.Unlock()
		if !suppressLeft {
			h.broadcast(c.roomID, event("participant.left", c.roomID, struct {
				ConnectionID string `json:"connection_id"`
			}{c.participant.ConnectionID}), c.id)
		}
		h.logger.Info("websocket left (explicit)", "connection_id", c.id, "participant_conn_id", c.participant.ConnectionID, "room_id", c.roomID)
		return
	}

	c.disconnected = true
	c.generation++
	gen := c.generation
	if c.graceTimer != nil {
		c.graceTimer.Stop()
	}

	roomID := c.roomID
	participantConnID := c.participant.ConnectionID
	c.graceTimer = time.AfterFunc(h.disconnectGracePeriod, func() {
		var leftData []byte
		h.mu.Lock()
		if !h.closing && h.rooms[roomID] == state && state.clients[c.id] == c && c.generation == gen && c.disconnected {
			delete(state.clients, c.id)
			if len(state.clients) == 0 && !h.closing {
				state.evict = time.AfterFunc(10*time.Minute, func() {
					released := false
					h.mu.Lock()
					if h.rooms[roomID] == state && len(state.clients) == 0 {
						if state.mediaTimer != nil {
							state.mediaTimer.Stop()
						}
						delete(h.rooms, roomID)
						released = true
					}
					h.mu.Unlock()
					if released {
						h.releaseMediaOwner(roomID)
					}
				})
			}
			leftData = event("participant.left", roomID, struct {
				ConnectionID string `json:"connection_id"`
			}{participantConnID})
		}
		h.mu.Unlock()

		if leftData != nil {
			h.broadcast(roomID, leftData, "")
			h.logger.Info("websocket left (grace period expired)", "connection_id", c.id, "participant_conn_id", participantConnID, "room_id", roomID)
		}
	})
	h.mu.Unlock()
	h.logger.Info("websocket disconnected (grace period started)", "connection_id", c.id, "room_id", c.roomID, "grace_period", h.disconnectGracePeriod)
}

func validReaction(emoji string) bool {
	switch emoji {
	case "❤️", "🔥", "👏", "😂", "👍", "🎉":
		return true
	}
	return false
}

func (h *Hub) broadcast(roomID string, data []byte, exclude string) {
	h.broadcasts.Add(1)
	h.broadcastLocal(roomID, data, exclude)
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	if bus != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		if err := bus.Publish(ctx, roomID, data); err != nil {
			h.logger.Warn("redis publish failed; delivered locally", "room_id", roomID, "error", err)
		}
		cancel()
	}
}

func (h *Hub) broadcastLocal(roomID string, data []byte, exclude string) {
	start := time.Now()
	defer func() { h.broadcastDuration.Observe(time.Since(start)) }()
	h.mu.RLock()
	state := h.rooms[roomID]
	clients := make([]*client, 0)
	if state != nil {
		for id, c := range state.clients {
			if id != exclude && !c.disconnected {
				clients = append(clients, c)
			}
		}
	}
	h.mu.RUnlock()
	for _, c := range clients {
		if !h.enqueue(c, data) {
			h.slowConsumers.Add(1)
			// A saturated peer may never read/acknowledge a close frame.
			// Do not wait for its handshake in the room broadcast path.
			_ = c.conn.CloseNow()
		}
	}
}

func (h *Hub) broadcastEphemeral(roomID string, data []byte) {
	h.broadcast(roomID, data, "")
}

func (s *roomState) allowReaction(now time.Time) bool {
	cutoff := now.Add(-2 * time.Second)
	kept := s.reactionTimes[:0]
	for _, at := range s.reactionTimes {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	s.reactionTimes = kept
	if len(s.reactionTimes) >= 20 {
		return false
	}
	s.reactionTimes = append(s.reactionTimes, now)
	return true
}

func (h *Hub) enqueue(c *client, data []byte) bool {
	select {
	case c.send <- data:
		return true
	default:
		return false
	}
}

func (h *Hub) sendError(c *client, code, message string) {
	h.enqueue(c, event("error", c.roomID, errorPayload{code, message}))
}

func event(eventType, roomID string, payload any) []byte {
	payloadJSON, _ := json.Marshal(payload)
	data, _ := json.Marshal(Envelope{Type: eventType, Version: protocolVersion, EventID: uuid.NewString(), RoomID: roomID, Payload: payloadJSON})
	return data
}

func (h *Hub) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	_, ok := h.origins[parsed.Scheme+"://"+parsed.Host]
	return ok
}
