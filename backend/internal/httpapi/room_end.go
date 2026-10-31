package httpapi

import (
	"context"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
	"net/http"
)

func (s *Server) endRoom(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, 401, "UNAUTHORIZED", "Authentication required")
		return
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
	if !domain.CanEndRoom(room, identity) {
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
	if err = repo.EndOwnedRoom(r.Context(), room.ID, identity.ID); err != nil {
		s.internal(w, r, "end room", err)
		return
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
