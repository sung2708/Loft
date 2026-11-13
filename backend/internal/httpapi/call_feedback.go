package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"loft/backend/internal/domain"
)

func (s *Server) callFeedback(w http.ResponseWriter, r *http.Request) {
	feedbacks, ok := s.store.(domain.CallFeedbackStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "FEEDBACK_UNAVAILABLE", "Feedback is temporarily unavailable")
		return
	}
	id := chi.URLParam(r, "roomID")
	if _, err := uuid.Parse(id); err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	// Feedback usually arrives right after leaving, often after the room ended.
	room, err := s.store.GetRoom(r.Context(), id)
	if err != nil && !errors.Is(err, domain.ErrRoomEnded) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.feedbackIdentity(r, room)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	if !s.feedbackLimit.AllowContext(r.Context(), identity.LiveKitIdentity()) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Please wait a moment before trying again")
		return
	}
	var feedback domain.CallFeedback
	if !decodeJSON(w, r, &feedback) {
		return
	}
	if err := feedback.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FEEDBACK", "Invalid feedback")
		return
	}
	feedback.RoomID, feedback.Identity = room.ID, identity
	if err := feedbacks.InsertCallFeedback(r.Context(), feedback); err != nil {
		s.internal(w, r, "store call feedback", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// feedbackIdentity accepts the guest token for this room or a user bearer.
// It deliberately skips membership checks: the caller may have just left.
func (s *Server) feedbackIdentity(r *http.Request, room domain.Room) (domain.Identity, error) {
	if raw := r.Header.Get("X-Guest-Token"); raw != "" {
		guest, err := s.guests.Verify(raw)
		if err != nil || guest.RoomID != room.ID {
			return domain.Identity{}, domain.ErrUnauthorized
		}
		return guest, nil
	}
	return s.authenticatedUser(r)
}

func (s *Server) adminCallQuality(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminStore(w, r); !ok {
		return
	}
	feedbacks, ok := s.store.(domain.CallFeedbackStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	summary, err := feedbacks.CallQualitySummary(r.Context(), time.Now().Add(-7*24*time.Hour))
	if err != nil {
		s.internal(w, r, "call quality summary", err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
