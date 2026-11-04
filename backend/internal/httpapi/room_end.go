package httpapi

import (
	"context"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
	"net/http"
	"strings"
)

func (s *Server) endRoom(w http.ResponseWriter, r *http.Request) { s.endRoomAuthorized(w, r, false) }

func (s *Server) adminEndRoom(w http.ResponseWriter, r *http.Request) {
	s.endRoomAuthorized(w, r, true)
}

func (s *Server) endRoomAuthorized(w http.ResponseWriter, r *http.Request, admin bool) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, 401, "UNAUTHORIZED", "Authentication required")
		return
	}
	if admin {
		if !s.isAdmin(identity.ID) {
			writeError(w, 403, "ADMIN_REQUIRED", "Admin access is required")
			return
		}
	}
	var decision struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	if admin {
		if !decodeJSON(w, r, &decision) {
			return
		}
		decision.Note = strings.TrimSpace(decision.Note)
		if !domain.ValidModerationReason(decision.Reason) || len([]rune(decision.Note)) < 10 || len([]rune(decision.Note)) > 1000 {
			writeError(w, 400, "INVALID_MODERATION", "Select a reason and provide a note between 10 and 1000 characters")
			return
		}
	}
	id := chi.URLParam(r, "roomID")
	if _, err = uuid.Parse(id); err != nil {
		writeError(w, 404, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	room, err := s.store.GetRoom(r.Context(), id)
	if err != nil && !errors.Is(err, domain.ErrRoomEnded) {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, 404, "ROOM_NOT_FOUND", "Room not found")
		} else {
			s.internal(w, r, "get room for ending", err)
		}
		return
	}
	if !admin && !domain.CanEndRoom(room, identity) {
		writeError(w, 403, "FORBIDDEN", "Only the room owner can end this room")
		return
	}
	repo, ok := s.store.(interface {
		EndOwnedRoom(context.Context, string, string) error
	})
	notifier, ready := s.deletion.(interface{ NotifyRoomEnded(string) })
	if !ok || !ready {
		writeError(w, 503, "ROOM_END_UNAVAILABLE", "Could not end the room")
		return
	}
	if admin {
		moderator, supported := s.store.(interface {
			ModerateRoom(context.Context, string, string, string, string) error
		})
		if !supported {
			writeError(w, 503, "ROOM_END_UNAVAILABLE", "Could not end the room")
			return
		}
		err = moderator.ModerateRoom(r.Context(), room.ID, identity.ID, decision.Reason, decision.Note)
	} else {
		err = repo.EndOwnedRoom(r.Context(), room.ID, room.OwnerID)
	}
	if err != nil {
		s.internal(w, r, "end room", err)
		return
	}
	if admin {
		s.logger.Info("admin ended room", "actor_id", identity.ID, "room_id", room.ID)
	}
	// Admission is closed durably before disconnecting sockets or SFU participants.
	mediaErr := s.livekit.EndRoom(r.Context(), room.ID)
	notifier.NotifyRoomEnded(room.ID)
	if mediaErr != nil {
		s.logger.Error("ended room media cleanup failed", "room_id", room.ID, "error", mediaErr)
		writeError(w, 503, "ROOM_END_MEDIA_PENDING", "Room ended; call cleanup needs retrying")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
