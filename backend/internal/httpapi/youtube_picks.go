package httpapi

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
	"loft/backend/internal/store"
	"net/http"
)

func (s *Server) listYouTubePicks(w http.ResponseWriter, r *http.Request) {
	if _, err := s.authenticatedUser(r); err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	repo, ok := s.store.(interface {
		ListRoomPicks(context.Context, string) ([]store.YouTubeRoomPick, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_PICKS_UNAVAILABLE", "Room picks are unavailable")
		return
	}
	picks, err := repo.ListRoomPicks(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		s.internal(w, r, "list youtube picks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"picks": picks})
}

func (s *Server) createYouTubePick(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if !domain.CanCreateRoomPick(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "You cannot add a room pick")
		return
	}
	var input struct{ VideoID, Title, Channel string }
	if json.NewDecoder(r.Body).Decode(&input) != nil || len(input.VideoID) != 11 {
		writeError(w, http.StatusBadRequest, "INVALID_PICK", "Invalid YouTube video")
		return
	}
	repo, ok := s.store.(interface {
		CreateRoomPick(context.Context, store.YouTubeRoomPick) error
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_PICKS_UNAVAILABLE", "Room picks are unavailable")
		return
	}
	pick := store.YouTubeRoomPick{ID: uuid.NewString(), RoomID: room.ID, VideoID: input.VideoID, Title: input.Title, Channel: input.Channel, SuggestedBy: identity.ID, Active: true}
	if err := repo.CreateRoomPick(r.Context(), pick); err != nil {
		s.internal(w, r, "create youtube pick", err)
		return
	}
	writeJSON(w, http.StatusCreated, pick)
}

func (s *Server) voteYouTubePick(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if !domain.CanVoteRoomPick(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "You cannot vote in this room")
		return
	}
	repo, ok := s.store.(interface {
		VoteRoomPick(context.Context, string, string) error
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_PICKS_UNAVAILABLE", "Room picks are unavailable")
		return
	}
	var input struct {
		PickID string `json:"pick_id"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil || input.PickID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_VOTE", "Pick ID is required")
		return
	}
	if err := repo.VoteRoomPick(r.Context(), input.PickID, identity.ID); err != nil {
		s.internal(w, r, "vote youtube pick", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "voted"})
}

func (s *Server) youtubeMediaSettings(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	roomID := chi.URLParam(r, "roomID")
	room, err := s.store.GetRoom(r.Context(), roomID)
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	repo, ok := s.store.(interface {
		SetAutoplay(context.Context, store.YouTubeMediaSettings) error
		GetMediaSettings(context.Context, string) (store.YouTubeMediaSettings, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_SETTINGS_UNAVAILABLE", "Media settings are unavailable")
		return
	}
	if r.Method == http.MethodGet {
		settings, getErr := repo.GetMediaSettings(r.Context(), roomID)
		if getErr != nil {
			writeJSON(w, http.StatusOK, store.YouTubeMediaSettings{RoomID: roomID, AutoplayEnabled: false})
			return
		}
		writeJSON(w, http.StatusOK, settings)
		return
	}
	if !domain.CanChangeAutoplay(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Only the host can change autoplay")
		return
	}
	var input struct {
		AutoplayEnabled bool `json:"autoplay_enabled"`
	}
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SETTINGS", "Invalid media settings")
		return
	}
	settings := store.YouTubeMediaSettings{RoomID: roomID, AutoplayEnabled: input.AutoplayEnabled, UpdatedBy: identity.ID}
	if err := repo.SetAutoplay(r.Context(), settings); err != nil {
		s.internal(w, r, "set youtube autoplay", err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}
