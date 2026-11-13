package httpapi

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/moderation"
	"loft/backend/internal/observability"
	"loft/backend/internal/ratelimit"
)

type Server struct {
	store               domain.Store
	deletion            RoomDeletionGuard
	users               *auth.SupabaseVerifier
	guests              *auth.GuestTokens
	livekit             *livekit.TokenService
	lookupLimit         *ratelimit.Limiter
	guestLimit          *ratelimit.Limiter
	passwordLimit       *ratelimit.Limiter
	boardLimit          *ratelimit.Limiter
	adminUserIDs        map[string]struct{}
	metricsBearerToken  string
	roomLimit           *ratelimit.Limiter
	youtubePickLimit    *ratelimit.Limiter
	youtubeSearchLimit  *ratelimit.Limiter
	youtubeSearchBudget *ratelimit.Limiter
	feedbackLimit       *ratelimit.Limiter
	origins             map[string]struct{}
	logger              *slog.Logger
	bans                *moderation.BanGate
	metrics             *observability.Metrics
	httpLogger          *zerolog.Logger
}

type RoomDeletionGuard interface {
	BeginDelete(roomID string) bool
	FinishDelete(roomID string, deleted bool)
}

// metricsProvider keeps the existing realtime metrics available while HTTP
// metrics are emitted by the Prometheus registry below.
type metricsProvider interface {
	PrometheusMetrics() string
}
type mediaAdmissionGuard interface {
	CanIssueMediaToken(context.Context, string, domain.Identity) (bool, error)
}
type roomPreview struct {
	ID                      string                `json:"id"`
	Slug                    string                `json:"slug"`
	Name                    string                `json:"name"`
	AllowGuests             bool                  `json:"allow_guests"`
	MaxParticipants         int                   `json:"max_participants"`
	IsLocked                bool                  `json:"is_locked"`
	PasswordRequired        bool                  `json:"password_required"`
	Atmosphere              domain.RoomAtmosphere `json:"atmosphere"`
	Accent                  domain.RoomAccent     `json:"accent"`
	AdaptiveMediaBackground bool                  `json:"adaptive_media_background"`
}

func preview(room domain.Room) roomPreview {
	room = domain.NormalizeRoomAppearance(room)
	return roomPreview{ID: room.ID, Slug: room.Slug, Name: room.Name, AllowGuests: room.AllowGuests, MaxParticipants: room.MaxParticipants, IsLocked: room.IsLocked, PasswordRequired: room.PasswordRequired, Atmosphere: room.Atmosphere, Accent: room.Accent, AdaptiveMediaBackground: room.AdaptiveMediaBackground}
}

func New(store domain.Store, users *auth.SupabaseVerifier, guests *auth.GuestTokens, livekitService *livekit.TokenService, origins []string, logger *slog.Logger, deletion ...RoomDeletionGuard) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	allowed := make(map[string]struct{}, len(origins))
	frontendOrigin := ""
	for _, origin := range origins {
		origin = strings.TrimRight(origin, "/")
		if frontendOrigin == "" {
			frontendOrigin = origin
		}
		allowed[origin] = struct{}{}
	}
	var guard RoomDeletionGuard
	if len(deletion) > 0 {
		guard = deletion[0]
	}
	var bans *moderation.BanGate
	if banStore, ok := store.(domain.AccountBanStore); ok {
		bans = moderation.NewBanGate(banStore)
	}
	return &Server{bans: bans, store: store, deletion: guard, users: users, guests: guests, livekit: livekitService,
		boardLimit: ratelimit.New(20, time.Second, 20), lookupLimit: ratelimit.New(30, time.Minute, 10), guestLimit: ratelimit.New(10, time.Minute, 5), passwordLimit: ratelimit.New(5, time.Minute, 3), roomLimit: ratelimit.New(10, time.Minute, 3), youtubePickLimit: ratelimit.New(10, time.Minute, 3), youtubeSearchLimit: ratelimit.New(20, time.Minute, 5), youtubeSearchBudget: ratelimit.New(300, time.Hour, 30), feedbackLimit: ratelimit.New(10, time.Minute, 5), origins: allowed, logger: logger, metrics: observability.NewMetrics()}
}

// ConfigureObservability is called once during process bootstrap before routes
// are served. It keeps test registries process-local and prevents duplicate
// registrations when more than one server is instantiated in a test process.
func (s *Server) ConfigureObservability(logger zerolog.Logger, metrics *observability.Metrics) {
	if metrics != nil {
		s.metrics = metrics
	}
	s.httpLogger = &logger
}

func (s *Server) ConfigureAdminUserIDs(ids []string) {
	s.adminUserIDs = make(map[string]struct{}, len(ids))
	for _, id := range ids {
		s.adminUserIDs[id] = struct{}{}
	}
}

func (s *Server) ConfigureMetricsBearerToken(token string) {
	s.metricsBearerToken = token
}

// ConfigureDistributedRateLimits shares abuse budgets across backend nodes.
// Each limiter retains a bounded in-process fallback for Redis outages.
func (s *Server) ConfigureDistributedRateLimits(remote ratelimit.Distributed) {
	s.lookupLimit.SetDistributed("room_lookup", remote)
	s.guestLimit.SetDistributed("guest_session", remote)
	s.passwordLimit.SetDistributed("room_password", remote)
	s.roomLimit.SetDistributed("room_create", remote)
	s.youtubePickLimit.SetDistributed("youtube_picks", remote)
	s.youtubeSearchLimit.SetDistributed("youtube_search_user", remote)
	s.youtubeSearchBudget.SetDistributed("youtube_search_shared", remote)
	s.boardLimit.SetDistributed("board_write", remote)
}

func (s *Server) Routes(ws http.Handler) http.Handler {
	if s.metrics == nil {
		s.metrics = observability.NewMetrics()
	}
	if s.httpLogger == nil {
		logger := zerolog.Nop()
		s.httpLogger = &logger
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, observability.HTTPMiddleware(*s.httpLogger, s.metrics), middleware.Recoverer, s.cors)
	r.Handle("/ws", ws)
	// Realtime metrics are retained below until they are migrated into the
	// registry. Disable compression because the two Prometheus text streams are
	// deliberately combined in this compatibility handler.
	prometheusHandler := promhttp.HandlerFor(s.metrics.Registry, promhttp.HandlerOpts{DisableCompression: true})
	r.Handle("/metrics", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.metricsBearerToken == "" {
			http.NotFound(w, r)
			return
		}
		authorization := r.Header.Get("Authorization")
		if !strings.HasPrefix(authorization, "Bearer ") || !hmac.Equal([]byte(strings.TrimPrefix(authorization, "Bearer ")), []byte(s.metricsBearerToken)) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		prometheusHandler.ServeHTTP(w, r)
		if realtimeMetrics, ok := ws.(metricsProvider); ok {
			_, _ = fmt.Fprint(w, realtimeMetrics.PrometheusMetrics())
		}
	}))
	r.Group(func(r chi.Router) {
		r.Use(middleware.Timeout(15 * time.Second))
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		r.Get("/ready", s.ready)
		r.Get("/readyz", s.ready)
		r.Route("/api/v1", func(r chi.Router) {
			r.Use(s.suspensionGate)
			r.Route("/admin", func(r chi.Router) {
				r.Get("/overview", s.adminOverview)
				r.Get("/users", s.adminUsers)
				r.Get("/rooms", s.adminRooms)
				r.Post("/rooms/{roomID}/end", s.adminEndRoom)
				r.Post("/users/{userID}/suspension", s.adminSuspendUser)
				r.Delete("/users/{userID}/suspension", s.adminLiftSuspension)
				r.Get("/audit", s.adminAudit)
				r.Get("/call-quality", s.adminCallQuality)
			})
			r.Get("/youtube/search", s.youtubeSearch)
			r.Get("/rooms/{roomID}/whiteboard", s.whiteboard)
			r.Patch("/rooms/{roomID}/whiteboard", s.whiteboard)
			r.Get("/rooms/{roomID}/youtube/picks", s.listYouTubePicks)
			r.Post("/rooms/{roomID}/youtube/picks", s.createYouTubePick)
			r.Post("/rooms/{roomID}/youtube/picks/vote", s.voteYouTubePick)
			r.Get("/rooms/{roomID}/youtube/settings", s.youtubeMediaSettings)
			r.Patch("/rooms/{roomID}/youtube/settings", s.youtubeMediaSettings)
			r.Get("/rooms/resolve", s.resolveRoom)
			r.Get("/rooms/{roomID}", s.getRoom)
			r.Post("/rooms/{roomID}/guest-session", s.guestSession)
			r.Post("/rooms/{roomID}/join-requests", s.requestJoin)
			r.Get("/rooms/{roomID}/join-requests", s.listJoinRequests)
			r.Patch("/rooms/{roomID}/join-requests/{userID}", s.resolveJoinRequest)
			r.Patch("/rooms/{roomID}", s.updateRoom)
			r.Get("/rooms/{roomID}/messages", s.messages)
			r.Post("/rooms/{roomID}/livekit-token", s.liveKitToken)
			r.Post("/rooms/{roomID}/call-feedback", s.callFeedback)
			r.Get("/users/me", s.me)
			r.Get("/rooms", s.listRooms)
			r.Post("/rooms", s.createRoom)
			r.Delete("/rooms/{roomID}", s.deleteRoom)
			r.Post("/rooms/{roomID}/end", s.endRoom)
		})
	})
	return r
}

func (s *Server) deleteRoom(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	roomID := chi.URLParam(r, "roomID")
	if _, err := uuid.Parse(roomID); err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	room, err := s.store.GetRoom(r.Context(), roomID)
	if errors.Is(err, domain.ErrRoomEnded) {
		err = nil
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for deletion", err)
		return
	}
	if !domain.CanDeleteRoom(room, identity) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if s.deletion == nil || !s.deletion.BeginDelete(room.ID) {
		writeError(w, http.StatusConflict, "ROOM_BUSY", "Room is active or being deleted")
		return
	}
	deleted := false
	defer func() { s.deletion.FinishDelete(room.ID, deleted) }()
	if err := s.store.DeleteOwnedRoom(r.Context(), room.ID, identity.ID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
			return
		}
		s.internal(w, r, "delete room", err)
		return
	}
	deleted = true
	s.logger.Info("room deleted", "request_id", middleware.GetReqID(r.Context()), "room_id", room.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) resolveRoom(w http.ResponseWriter, r *http.Request) {
	if !s.lookupLimit.AllowContext(r.Context(), observability.ClientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room lookups")
		return
	}
	identifier, err := domain.NormalizeRoomIdentifier(r.URL.Query().Get("value"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_IDENTIFIER", "Enter a valid room ID or invite link")
		return
	}
	room, err := s.store.GetRoom(r.Context(), identifier)
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "resolve room", err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Room roomPreview `json:"room"`
	}{Room: preview(room)})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := s.store.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "NOT_READY", "Database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) getRoom(w http.ResponseWriter, r *http.Request) {
	if !s.lookupLimit.AllowContext(r.Context(), observability.ClientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room lookups")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room", err)
		return
	}
	writeJSON(w, http.StatusOK, preview(room))
}

func (s *Server) guestSession(w http.ResponseWriter, r *http.Request) {
	if !s.guestLimit.AllowContext(r.Context(), observability.ClientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many guest sessions")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for guest", err)
		return
	}
	if !room.AllowGuests {
		writeError(w, http.StatusForbidden, "ROOM_ACCESS_DENIED", "This room does not allow guests")
		return
	}
	if room.IsLocked {
		writeError(w, http.StatusForbidden, "ROOM_LOCKED", "This room is locked")
		return
	}
	var input struct {
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	name, err := domain.ValidateDisplayName(input.DisplayName)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DISPLAY_NAME", "Display name must be 2–48 characters")
		return
	}
	if room.PasswordRequired {
		if !s.passwordLimit.AllowContext(r.Context(), observability.ClientIP(r)+":"+room.ID) {
			writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Please wait a moment before trying again")
			return
		}
		if !auth.VerifyRoomPassword(input.Password, room.PasswordVerifier) {
			writeError(w, http.StatusForbidden, "INVALID_ROOM_PASSWORD", "That password doesn't look right. Try again.")
			return
		}
	}
	token, identity, expiresAt, err := s.guests.Issue(room.ID, name)
	if err != nil {
		s.internal(w, r, "issue guest token", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "guest_id": identity.ID, "display_name": name, "room_id": room.ID, "expires_at": expiresAt})
}

func (s *Server) updateRoom(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	accessStore, ok := s.store.(domain.RoomAccessStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ROOM_ACCESS_UNAVAILABLE", "Room settings are temporarily unavailable")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "This room isn't available.")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for update", err)
		return
	}
	if !domain.CanManageRoomAccess(room, identity) {
		writeError(w, http.StatusForbidden, "ROOM_ACCESS_DENIED", "You cannot change this room's settings")
		return
	}
	var input struct {
		ExpectedVersion int64  `json:"expected_version"`
		Name            string `json:"name"`
		AllowGuests     bool   `json:"allow_guests"`
		PasswordEnabled bool   `json:"password_enabled"`
		Password        string `json:"password"`
		Locked          bool   `json:"locked"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	name, err := domain.ValidateRoomName(input.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_NAME", "Room name must be 2–80 characters")
		return
	}
	verifier := ""
	if input.PasswordEnabled {
		if strings.TrimSpace(input.Password) == "" && room.PasswordRequired {
			verifier = room.PasswordVerifier
		} else {
			verifier, err = auth.HashRoomPassword(input.Password)
			if err != nil {
				writeError(w, http.StatusBadRequest, "INVALID_ROOM_PASSWORD", "Room password must be at least 4 characters")
				return
			}
		}
	}
	updated, err := accessStore.UpdateRoomAccess(r.Context(), room.ID, identity.ID, input.ExpectedVersion, domain.RoomAccessUpdate{Name: name, AllowGuests: input.AllowGuests, PasswordEnabled: input.PasswordEnabled, Password: verifier, Locked: input.Locked})
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "ROOM_VERSION_CONFLICT", "Room settings changed. Refresh and try again.")
		return
	}
	if err != nil {
		s.internal(w, r, "update room access", err)
		return
	}
	if notifier, ok := s.deletion.(interface{ NotifyRoomAccess(domain.Room) }); ok {
		notifier.NotifyRoomAccess(updated)
	}
	s.logger.Info("room access changed", "request_id", middleware.GetReqID(r.Context()), "room_id", room.ID, "password_required", updated.PasswordRequired, "locked", updated.IsLocked)
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if err := s.store.UpsertProfile(r.Context(), identity); err != nil {
		s.internal(w, r, "upsert profile", err)
		return
	}
	writeJSON(w, http.StatusOK, identity)
}

func (s *Server) listRooms(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	rooms, err := s.store.ListOwnedRooms(r.Context(), identity.ID)
	if err != nil {
		s.internal(w, r, "list rooms", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": rooms})
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	if !s.roomLimit.AllowContext(r.Context(), observability.ClientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room creation attempts")
		return
	}
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Google sign-in required to create a room")
		return
	}
	var input struct {
		Name            string `json:"name"`
		AllowGuests     *bool  `json:"allow_guests"`
		PasswordEnabled bool   `json:"password_enabled"`
		Password        string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	name, err := domain.ValidateRoomName(input.Name)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_NAME", "Room name must be 2–80 characters")
		return
	}
	allowGuests := true
	if input.AllowGuests != nil {
		allowGuests = *input.AllowGuests
	}
	verifier := ""
	if input.PasswordEnabled {
		verifier, err = auth.HashRoomPassword(input.Password)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_ROOM_PASSWORD", "Room password must be at least 4 characters")
			return
		}
	}
	if err := s.store.UpsertProfile(r.Context(), identity); err != nil {
		s.internal(w, r, "upsert creator", err)
		return
	}
	room, err := s.store.CreateRoom(r.Context(), domain.CreateRoomParams{Name: name, Owner: identity, AllowGuests: allowGuests, Password: verifier})
	if err != nil {
		s.internal(w, r, "create room", err)
		return
	}
	writeJSON(w, http.StatusCreated, room)
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for messages", err)
		return
	}
	if _, err := s.requestIdentity(r, room); err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	messages, err := s.store.RecentMessages(r.Context(), room.ID, 50)
	if err != nil {
		s.internal(w, r, "load messages", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (s *Server) liveKitToken(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for LiveKit", err)
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	if guard, ok := s.deletion.(mediaAdmissionGuard); ok {
		admitted, err := guard.CanIssueMediaToken(r.Context(), room.ID, identity)
		if err != nil {
			s.internal(w, r, "check media admission", err)
			return
		}
		if !admitted {
			writeError(w, http.StatusForbidden, "ROOM_ACCESS_DENIED", "Join the room before requesting media access")
			return
		}
	}
	token, err := s.livekit.Create(room, identity)
	if err != nil {
		s.logger.Error("LiveKit token failed", "room_id", room.ID, "identity_type", identity.Type, "error", err)
		writeError(w, http.StatusServiceUnavailable, "LIVEKIT_TOKEN_FAILED", "Voice and video are temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (s *Server) requestIdentity(r *http.Request, room domain.Room) (domain.Identity, error) {
	var identity domain.Identity
	if raw := strings.TrimSpace(r.Header.Get("X-Guest-Token")); raw != "" {
		guest, err := s.guests.Verify(raw)
		if err == nil && domain.CanJoin(room, guest) {
			identity = guest
		} else {
			return domain.Identity{}, domain.ErrUnauthorized
		}
	} else {
		user, err := s.authenticatedUser(r)
		if err != nil || !s.canAccessRoom(r.Context(), room, user) {
			return domain.Identity{}, domain.ErrUnauthorized
		}
		identity = user
	}
	if governance, ok := s.store.(domain.GovernanceStore); ok {
		banned, err := governance.IsBanned(r.Context(), room.ID, identity)
		if err != nil {
			return domain.Identity{}, err
		}
		if banned {
			return domain.Identity{}, domain.ErrBanned
		}
	}
	return identity, nil
}

func (s *Server) writeRoomIdentityError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, domain.ErrBanned) {
		writeError(w, http.StatusForbidden, "ROOM_KICKED", "You were removed from this room")
	} else if errors.Is(err, domain.ErrUnauthorized) {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Valid room identity required")
	} else {
		s.internal(w, r, "check room admission", err)
	}
}

func (s *Server) canAccessRoom(ctx context.Context, room domain.Room, identity domain.Identity) bool {
	if identity.Type == domain.IdentityGuest {
		return domain.CanJoin(room, identity)
	}
	if identity.Type != domain.IdentityUser || identity.ID == "" {
		return false
	}
	if room.AllowGuests || identity.ID == room.OwnerID {
		return true
	}
	members, ok := s.store.(domain.RoomMembershipStore)
	if !ok {
		return false
	}
	member, err := members.IsRoomMember(ctx, room.ID, identity.ID)
	return err == nil && member
}

func (s *Server) requestJoin(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Sign in to request access")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusGone, "ROOM_ENDED", "This room has ended")
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for join request", err)
		return
	}
	if room.AllowGuests || identity.ID == room.OwnerID {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_required"})
		return
	}
	members, ok := s.store.(domain.RoomMembershipStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ROOM_ACCESS_UNAVAILABLE", "Room access is temporarily unavailable")
		return
	}
	member, err := members.IsRoomMember(r.Context(), room.ID, identity.ID)
	if err != nil {
		s.internal(w, r, "check room membership", err)
		return
	}
	if member {
		writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
		return
	}
	if err := members.RequestRoomAccess(r.Context(), room.ID, identity); err != nil {
		s.internal(w, r, "request room access", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
}

func (s *Server) listJoinRequests(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	members, ok := s.store.(domain.RoomMembershipStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ROOM_ACCESS_UNAVAILABLE", "Room access is temporarily unavailable")
		return
	}
	items, err := members.ListJoinRequests(r.Context(), chi.URLParam(r, "roomID"), identity.ID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusForbidden, "ROOM_ACCESS_DENIED", "You cannot manage this room")
		return
	}
	if err != nil {
		s.internal(w, r, "list room join requests", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": items})
}

func (s *Server) resolveJoinRequest(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	var input struct {
		Approve bool `json:"approve"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	members, ok := s.store.(domain.RoomMembershipStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ROOM_ACCESS_UNAVAILABLE", "Room access is temporarily unavailable")
		return
	}
	err = members.ResolveJoinRequest(r.Context(), chi.URLParam(r, "roomID"), identity.ID, chi.URLParam(r, "userID"), input.Approve)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "JOIN_REQUEST_NOT_FOUND", "Join request not found")
		return
	}
	if err != nil {
		s.internal(w, r, "resolve room join request", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"approved": input.Approve})
}

func (s *Server) authenticatedUser(r *http.Request) (domain.Identity, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	identity, err := s.users.Verify(r.Context(), strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
	if err != nil {
		return identity, err
	}
	// Suspended accounts are rejected at every authenticated REST entry point.
	if err := s.bans.Check(r.Context(), identity); err != nil {
		return domain.Identity{}, err
	}
	return identity, nil
}

// suspensionGate turns a suspended bearer into a clear 403 before any handler
// runs, so clients can show a specific message instead of a sign-in loop.
func (s *Server) suspensionGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.bans != nil && strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			if _, err := s.authenticatedUser(r); errors.Is(err, domain.ErrAccountSuspended) {
				writeError(w, http.StatusForbidden, "ACCOUNT_SUSPENDED", "This account is suspended")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := s.origins[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Guest-Token, If-None-Match")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			if _, ok := s.origins[origin]; !ok {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) internal(w http.ResponseWriter, r *http.Request, operation string, err error) {
	s.logger.Error(operation, "request_id", middleware.GetReqID(r.Context()), "error", err)
	writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PAYLOAD", "Invalid request payload")
		return false
	}
	return true
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
