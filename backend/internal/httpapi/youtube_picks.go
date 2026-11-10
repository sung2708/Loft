package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"loft/backend/internal/domain"
	"loft/backend/internal/store"
	"loft/backend/internal/youtube"
)

func (s *Server) listYouTubePicks(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	if !domain.CanJoin(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "You cannot access this room")
		return
	}
	repo, ok := s.store.(interface {
		ListRoomPicks(context.Context, string) ([]store.YouTubeRoomPick, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_PICKS_UNAVAILABLE", "Room picks are unavailable")
		return
	}
	picks, err := repo.ListRoomPicks(r.Context(), room.ID)
	if err != nil {
		s.internal(w, r, "list youtube picks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"picks": picks})
}

func (s *Server) createYouTubePick(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	if !domain.CanCreateRoomPick(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "You cannot add a room pick")
		return
	}
	if s.youtubePickLimit != nil && !s.youtubePickLimit.Allow(identity.ID+":"+room.ID) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many room picks created; try again shortly")
		return
	}
	var input struct{ VideoID, Title, Channel string }
	if !decodeYouTubeJSON(w, r, &input) || !youtube.ValidVideoID(input.VideoID) || utf8.RuneCountInString(input.Title) > 140 || utf8.RuneCountInString(input.Channel) > 80 {
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
	pick := store.YouTubeRoomPick{
		ID:              uuid.NewString(),
		RoomID:          room.ID,
		VideoID:         input.VideoID,
		Title:           input.Title,
		Channel:         input.Channel,
		SuggestedBy:     identity.ID,
		SuggestedByType: identity.Type,
		Active:          true,
	}
	if err := repo.CreateRoomPick(r.Context(), pick); err != nil {
		if errors.Is(err, store.ErrPickCapacityReached) {
			writeError(w, http.StatusConflict, "ROOM_PICKS_FULL", "Room pick capacity reached (maximum 50 picks)")
			return
		}
		if errors.Is(err, domain.ErrConflict) {
			writeError(w, http.StatusConflict, "DUPLICATE_PICK", "Video already exists in Room Picks")
			return
		}
		s.internal(w, r, "create youtube pick", err)
		return
	}
	if notifier, ok := s.deletion.(interface{ NotifyPickCreated(store.YouTubeRoomPick) }); ok {
		notifier.NotifyPickCreated(pick)
	}
	writeJSON(w, http.StatusCreated, pick)
}

func (s *Server) voteYouTubePick(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	if !domain.CanVoteRoomPick(room, identity) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "You cannot vote in this room")
		return
	}
	repo, ok := s.store.(interface {
		VoteRoomPick(context.Context, string, string, domain.Identity) (int, error)
	})
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "YOUTUBE_PICKS_UNAVAILABLE", "Room picks are unavailable")
		return
	}
	var input struct {
		PickID string `json:"pick_id"`
	}
	if !decodeYouTubeJSON(w, r, &input) || uuid.Validate(input.PickID) != nil {
		writeError(w, http.StatusBadRequest, "INVALID_VOTE", "Pick ID is required")
		return
	}
	votes, err := repo.VoteRoomPick(r.Context(), room.ID, input.PickID, identity)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "PICK_NOT_FOUND", "Pick not found in this room")
			return
		}
		if errors.Is(err, store.ErrAlreadyVoted) {
			writeError(w, http.StatusConflict, "ALREADY_VOTED", "You have already voted for this pick")
			return
		}
		s.internal(w, r, "vote youtube pick", err)
		return
	}
	if notifier, ok := s.deletion.(interface{ NotifyPickVote(string, string, int) }); ok {
		notifier.NotifyPickVote(room.ID, input.PickID, votes)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "voted"})
}

func (s *Server) youtubeMediaSettings(w http.ResponseWriter, r *http.Request) {
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	identity, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
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
		settings, getErr := repo.GetMediaSettings(r.Context(), room.ID)
		if getErr != nil {
			writeJSON(w, http.StatusOK, store.YouTubeMediaSettings{RoomID: room.ID, AutoplayEnabled: false})
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
	if !decodeYouTubeJSON(w, r, &input) {
		writeError(w, http.StatusBadRequest, "INVALID_SETTINGS", "Invalid media settings")
		return
	}
	settings := store.YouTubeMediaSettings{RoomID: room.ID, AutoplayEnabled: input.AutoplayEnabled, UpdatedBy: identity.ID}
	if authority, ok := s.deletion.(interface {
		SetRoomAutoplay(context.Context, domain.Room, domain.Identity, bool) error
	}); ok {
		err = authority.SetRoomAutoplay(r.Context(), room, identity, input.AutoplayEnabled)
	} else {
		err = repo.SetAutoplay(r.Context(), settings)
	}
	if err != nil {
		s.internal(w, r, "set youtube autoplay", err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func decodeYouTubeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	decoder := json.NewDecoder(r.Body)
	if decoder.Decode(target) != nil {
		return false
	}
	var trailing any
	return decoder.Decode(&trailing) == io.EOF
}
