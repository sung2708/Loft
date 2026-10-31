package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-chi/chi/v5"
	"loft/backend/internal/domain"
	"loft/backend/internal/store"
	"net/http"
)

func (s *Server) whiteboard(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, 404, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		writeError(w, 401, "UNAUTHORIZED", "Valid room identity required")
		return
	}
	if governance, ok := s.store.(domain.GovernanceStore); ok {
		banned, err := governance.IsBanned(r.Context(), room.ID, identity)
		if err != nil {
			s.internal(w, r, "check board admission", err)
			return
		}
		if banned {
			writeError(w, 403, "ROOM_KICKED", "You were removed from this room")
			return
		}
	}
	if guard, ok := s.deletion.(mediaAdmissionGuard); ok {
		admitted, err := guard.CanIssueMediaToken(r.Context(), room.ID, identity)
		if err != nil || !admitted {
			writeError(w, 403, "ROOM_ACCESS_DENIED", "Join the room first")
			return
		}
	}
	repo, ok := s.store.(store.BoardRepository)
	if !ok {
		writeError(w, 503, "BOARD_UNAVAILABLE", "Whiteboard is unavailable")
		return
	}
	if r.Method == http.MethodGet {
		if tag := r.Header.Get("If-None-Match"); tag != "" {
			version, err := repo.BoardVersion(r.Context(), room.ID)
			if err != nil {
				s.internal(w, r, "load whiteboard version", err)
				return
			}
			current := fmt.Sprintf(`"board-%d"`, version)
			if tag == current {
				w.Header().Set("ETag", current)
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
		snapshot, err := repo.LoadBoard(r.Context(), room.ID)
		if err != nil {
			s.internal(w, r, "load whiteboard", err)
			return
		}
		w.Header().Set("ETag", fmt.Sprintf(`"board-%d"`, snapshot.Version))
		writeJSON(w, 200, snapshot)
		return
	}
	if !s.boardLimit.AllowContext(r.Context(), room.ID+":"+identity.LiveKitIdentity()) {
		writeError(w, 429, "RATE_LIMITED", "Please wait before drawing again")
		return
	}
	var patch store.BoardPatch
	r.Body = http.MaxBytesReader(w, r.Body, 256<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		writeError(w, 400, "INVALID_BOARD", "Invalid whiteboard update")
		return
	}
	snapshot, err := repo.PatchBoard(r.Context(), room.ID, patch)
	if errors.Is(err, store.ErrBoardConflict) {
		writeJSON(w, 409, snapshot)
		return
	}
	if errors.Is(err, store.ErrBoardInvalid) {
		writeError(w, 400, "INVALID_BOARD", "Unsupported whiteboard content")
		return
	}
	if errors.Is(err, store.ErrBoardLimit) {
		writeError(w, 413, "BOARD_LIMIT", "Whiteboard is full")
		return
	}
	if err != nil {
		s.internal(w, r, "save whiteboard", err)
		return
	}
	if notifier, ok := s.deletion.(interface{ NotifyBoard(string, int64) }); ok {
		notifier.NotifyBoard(room.ID, snapshot.Version)
	}
	writeJSON(w, 200, snapshot)
}
