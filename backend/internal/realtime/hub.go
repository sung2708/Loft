package realtime

import (
	"context"
	"encoding/json"
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
	Locked bool `json:"locked"`
}
type kickPayload struct {
	ConnectionID string `json:"connection_id"`
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
	joinError      string
	id             string
	tabSessionID   string
	roomID         string
	identity       domain.Identity
	participant    domain.Participant
	conn           *websocket.Conn
	send           chan []byte
	chatTokens     chan struct{}
	reactionTokens chan struct{}
	explicitLeave  bool
	disconnected   bool
	isReconnect    bool
	generation     uint64
	graceTimer     *time.Timer
	replaced       *client
}

type roomState struct {
	clients       map[string]*client
	media         mediaState
	room          domain.Room
	evict         *time.Timer
	mediaTimer    *time.Timer
	reactionTimes []time.Time
	locked        bool
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
	bus                   roomBus
	connectionsAccepted   atomic.Uint64
	broadcasts            atomic.Uint64
	slowConsumers         atomic.Uint64
}

type roomBus interface {
	Publish(context.Context, string, []byte) error
}
type presenceBus interface {
	RefreshPresence(context.Context, string, string, string) error
	ClearPresence(context.Context, string, string, string) error
}

func New(store domain.Store, guests *auth.GuestTokens, users *auth.SupabaseVerifier, origins []string, logger *slog.Logger) *Hub {
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
func (h *Hub) SetBus(bus roomBus) { h.mu.Lock(); h.bus = bus; h.mu.Unlock() }

func (h *Hub) PrometheusMetrics() string {
	return fmt.Sprintf("loft_realtime_connections_accepted_total %d\nloft_realtime_broadcasts_total %d\nloft_realtime_slow_consumers_total %d\n", h.connectionsAccepted.Load(), h.broadcasts.Load(), h.slowConsumers.Load())
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
	cancels := make([]context.CancelFunc, 0, len(h.cancels))
	for _, cancel := range h.cancels {
		cancels = append(cancels, cancel)
	}
	for _, room := range h.rooms {
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
	defer h.mu.Unlock()
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
	if !h.connectionLimit.Allow(host) {
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
		id: uuid.NewString(), tabSessionID: tabSessionID, roomID: room.ID, identity: identity, conn: conn, send: make(chan []byte, outboundCapacity), chatTokens: make(chan struct{}, 5), reactionTokens: make(chan struct{}, 4),
		participant: domain.Participant{ConnectionID: "", IdentityID: identity.ID, IdentityType: identity.Type, DisplayName: identity.DisplayName, AvatarURL: identity.AvatarURL, Role: role, LiveKitIdentity: identity.LiveKitIdentity(), JoinedAt: time.Now().UTC()},
	}
	c.participant.ConnectionID = c.id
	participants, media, added := h.add(c, room)
	if !added {
		writeCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		_ = conn.Write(writeCtx, websocket.MessageText, event("error", room.ID, errorPayload{c.joinError, "Room admission denied"}))
		stop()
		return
	}
	if c.replaced != nil {
		_ = c.replaced.conn.CloseNow()
	}
	h.connectionsAccepted.Add(1)
	defer h.remove(c)
	defer h.clearPresence(c)
	h.refreshPresence(ctx, c)

	writeDone := make(chan error, 1)
	var pumps sync.WaitGroup
	pumps.Add(1)
	go func() { defer pumps.Done(); writeDone <- h.writePump(ctx, c) }()
	defer func() { cancel(); _ = conn.CloseNow(); pumps.Wait() }()
	if !h.enqueue(c, event("room.snapshot", room.ID, snapshotPayload{Room: room, Self: c.participant, Participants: participants, Messages: messages, Media: media})) {
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
			c.explicitLeave = true
			_ = c.conn.Close(websocket.StatusNormalClosure, "left room")
			return nil
		case "room.lock":
			var payload roomLockPayload
			if json.Unmarshal(envelope.Payload, &payload) != nil {
				h.sendError(c, "INVALID_PAYLOAD", "Invalid room lock payload")
				continue
			}
			h.mu.Lock()
			state := h.rooms[c.roomID]
			allowed := state != nil && domain.CanChangeSettings(state.room, c.identity)
			if allowed {
				state.locked = payload.Locked
			}
			h.mu.Unlock()
			if !allowed {
				h.sendError(c, "ROOM_COMMAND_REJECTED", "room permission denied")
				continue
			}
			h.broadcast(c.roomID, event("room.locked", c.roomID, payload), "")
		case "participant.kick":
			var payload kickPayload
			if json.Unmarshal(envelope.Payload, &payload) != nil || payload.ConnectionID == "" {
				h.sendError(c, "INVALID_PAYLOAD", "Invalid participant target")
				continue
			}
			h.mu.RLock()
			state := h.rooms[c.roomID]
			var target *client
			if state != nil && domain.CanKick(state.room, c.identity) {
				target = state.clients[payload.ConnectionID]
			}
			h.mu.RUnlock()
			if target == nil || target == c {
				h.sendError(c, "ROOM_COMMAND_REJECTED", "participant cannot be removed")
				continue
			}
			_ = target.conn.CloseNow()
		case "connection.ping":
			var ping pingPayload
			_ = json.Unmarshal(envelope.Payload, &ping)
			h.enqueue(c, event("connection.pong", c.roomID, pongPayload{ping.ClientTime, time.Now().UnixMilli()}))
			h.refreshPresence(ctx, c)
		case "chat.send":
			select {
			case c.chatTokens <- struct{}{}:
				time.AfterFunc(3*time.Second, func() { <-c.chatTokens })
			default:
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
			select {
			case c.reactionTokens <- struct{}{}:
				time.AfterFunc(2*time.Second, func() { <-c.reactionTokens })
			default:
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
			if !limiter.Allow(key) {
				h.sendError(c, "MEDIA_RATE_LIMITED", "Too many media commands")
				continue
			}
			h.mu.Lock()
			state := h.rooms[c.roomID]
			var applyErr error
			var media mediaState
			if state == nil {
				applyErr = errMediaDenied
			} else {
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
			h.broadcast(c.roomID, event("media.state", c.roomID, media), "")
		default:
			h.sendError(c, "UNKNOWN_EVENT", "Unsupported event type")
		}
	}
}

func (h *Hub) refreshPresence(parent context.Context, c *client) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	presence, ok := bus.(presenceBus)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 500*time.Millisecond)
	defer cancel()
	if err := presence.RefreshPresence(ctx, c.roomID, c.identity.LiveKitIdentity(), c.id); err != nil {
		h.logger.Warn("redis presence refresh failed; local presence continues", "room_id", c.roomID, "error", err)
	}
}

func (h *Hub) clearPresence(c *client) {
	h.mu.RLock()
	bus := h.bus
	h.mu.RUnlock()
	presence, ok := bus.(presenceBus)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := presence.ClearPresence(ctx, c.roomID, c.identity.LiveKitIdentity(), c.id); err != nil {
		h.logger.Warn("redis presence clear failed", "room_id", c.roomID, "error", err)
	}
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
		state = &roomState{clients: make(map[string]*client), room: room, media: mediaState{Queue: []youtubeTrack{}, Status: "IDLE"}}
		h.rooms[c.roomID] = state
	}
	if state.locked && c.identity.Type == domain.IdentityGuest {
		c.joinError = "ROOM_LOCKED"
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
		h.mu.Lock()
		if h.closing || h.rooms[roomID] != state || state.media.Version != version {
			h.mu.Unlock()
			return
		}
		if !state.media.finish(time.Now().UTC()) {
			h.scheduleMediaEnd(roomID, state)
			h.mu.Unlock()
			return
		}
		media := state.media.snapshot()
		h.scheduleMediaEnd(roomID, state)
		h.mu.Unlock()
		h.broadcast(roomID, event("media.state", roomID, media), "")
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
		delete(state.clients, c.id)
		if c.graceTimer != nil {
			c.graceTimer.Stop()
			c.graceTimer = nil
		}
		if len(state.clients) == 0 && !h.closing {
			state.evict = time.AfterFunc(10*time.Minute, func() {
				h.mu.Lock()
				if h.rooms[c.roomID] == state && len(state.clients) == 0 {
					if state.mediaTimer != nil {
						state.mediaTimer.Stop()
					}
					delete(h.rooms, c.roomID)
				}
				h.mu.Unlock()
			})
		}
		h.mu.Unlock()
		h.broadcast(c.roomID, event("participant.left", c.roomID, struct {
			ConnectionID string `json:"connection_id"`
		}{c.participant.ConnectionID}), c.id)
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
					h.mu.Lock()
					if h.rooms[roomID] == state && len(state.clients) == 0 {
						if state.mediaTimer != nil {
							state.mediaTimer.Stop()
						}
						delete(h.rooms, roomID)
					}
					h.mu.Unlock()
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
