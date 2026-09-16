package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/ratelimit"
	"loft/backend/internal/telemetry"
)

type Server struct {
	store         domain.Store
	deletion      RoomDeletionGuard
	users         *auth.SupabaseVerifier
	guests        *auth.GuestTokens
	livekit       *livekit.TokenService
	lookupLimit   *ratelimit.Limiter
	guestLimit    *ratelimit.Limiter
	passwordLimit *ratelimit.Limiter
	roomLimit     *ratelimit.Limiter
	origins       map[string]struct{}
	logger        *slog.Logger
	httpRequests  atomic.Uint64
	httpDuration  telemetry.DurationHistogram
}

type RoomDeletionGuard interface {
	BeginDelete(roomID string) bool
	FinishDelete(roomID string, deleted bool)
}
type mediaAdmissionGuard interface {
	CanIssueMediaToken(context.Context, string, domain.Identity) (bool, error)
}
type metricsProvider interface{ PrometheusMetrics() string }

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
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	var guard RoomDeletionGuard
	if len(deletion) > 0 {
		guard = deletion[0]
	}
	return &Server{store: store, deletion: guard, users: users, guests: guests, livekit: livekitService,
		lookupLimit: ratelimit.New(30, time.Minute, 10), guestLimit: ratelimit.New(10, time.Minute, 5), passwordLimit: ratelimit.New(5, time.Minute, 3), roomLimit: ratelimit.New(10, time.Minute, 3), origins: allowed, logger: logger}
}

// ConfigureDistributedRateLimits shares abuse budgets across backend nodes.
// Each limiter retains a bounded in-process fallback for Redis outages.
func (s *Server) ConfigureDistributedRateLimits(remote ratelimit.Distributed) {
	s.lookupLimit.SetDistributed("room_lookup", remote)
	s.guestLimit.SetDistributed("guest_session", remote)
	s.passwordLimit.SetDistributed("room_password", remote)
	s.roomLimit.SetDistributed("room_create", remote)
}

func (s *Server) Routes(ws http.Handler) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, s.observeHTTP, middleware.Recoverer, s.cors)
	r.Handle("/ws", ws)
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
			r.Get("/rooms/resolve", s.resolveRoom)
			r.Get("/rooms/{roomID}", s.getRoom)
			r.Post("/rooms/{roomID}/guest-session", s.guestSession)
			r.Patch("/rooms/{roomID}", s.updateRoom)
			r.Get("/rooms/{roomID}/messages", s.messages)
			r.Post("/rooms/{roomID}/livekit-token", s.liveKitToken)
			r.Get("/users/me", s.me)
			r.Get("/rooms", s.listRooms)
			r.Post("/rooms", s.createRoom)
			r.Delete("/rooms/{roomID}", s.deleteRoom)
		})
	})
	if metrics, ok := ws.(metricsProvider); ok {
		r.Get("/metrics", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain; version=0.0.4")
			_, _ = fmt.Fprint(w, s.prometheusMetrics(), metrics.PrometheusMetrics())
		})
	}
	return r
}

func (s *Server) observeHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		defer func() {
			s.httpRequests.Add(1)
			s.httpDuration.Observe(time.Since(start))
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) prometheusMetrics() string {
	return fmt.Sprintf("# HELP loft_http_requests_total HTTP requests served by this process.\n# TYPE loft_http_requests_total counter\nloft_http_requests_total %d\n", s.httpRequests.Load()) +
		s.httpDuration.Prometheus("loft_http_request_duration_seconds", "HTTP handler duration in seconds.")
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
	if !s.lookupLimit.AllowContext(r.Context(), clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room lookups")
		return
	}
	identifier, err := domain.NormalizeRoomIdentifier(r.URL.Query().Get("value"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_IDENTIFIER", "Enter a valid room ID or invite link")
		return
	}
	room, err := s.store.GetRoom(r.Context(), identifier)
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
	if !s.lookupLimit.AllowContext(r.Context(), clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room lookups")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
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
	if !s.guestLimit.AllowContext(r.Context(), clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many guest sessions")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
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
		if !s.passwordLimit.AllowContext(r.Context(), clientIP(r)+":"+room.ID) {
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
	s.logger.Info("room access changed", "request_id", middleware.GetReqID(r.Context()), "room_id", room.ID, "password_required", updated.PasswordRequired, "locked", updated.IsLocked)
	writeJSON(w, http.StatusOK, preview(updated))
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
	if !s.roomLimit.AllowContext(r.Context(), clientIP(r)) {
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
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for messages", err)
		return
	}
	if _, err := s.requestIdentity(r, room); err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Valid room identity required")
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
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Valid room identity required")
		return
	}
	if governance, ok := s.store.(domain.GovernanceStore); ok {
		banned, err := governance.IsBanned(r.Context(), room.ID, identity)
		if err != nil {
			s.internal(w, r, "check room ban", err)
			return
		}
		if banned {
			writeError(w, http.StatusForbidden, "ROOM_KICKED", "You were removed from this room")
			return
		}
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
	if raw := strings.TrimSpace(r.Header.Get("X-Guest-Token")); raw != "" {
		identity, err := s.guests.Verify(raw)
		if err == nil && domain.CanJoin(room, identity) {
			return identity, nil
		}
		return domain.Identity{}, domain.ErrUnauthorized
	}
	identity, err := s.authenticatedUser(r)
	if err != nil || !domain.CanJoin(room, identity) {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	return identity, nil
}

func (s *Server) authenticatedUser(r *http.Request) (domain.Identity, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return domain.Identity{}, domain.ErrUnauthorized
	}
	return s.users.Verify(r.Context(), strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := s.origins[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Guest-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
