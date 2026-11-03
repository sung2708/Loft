package httpapi

import (
	"loft/backend/internal/youtube"
	"net/http"
	"os"
	"strings"
)

func (s *Server) youtubeSearch(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("YOUTUBE_ENABLED") == "false" {
		writeError(w, http.StatusNotFound, "YOUTUBE_DISABLED", "YouTube search is unavailable")
		return
	}
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len([]rune(q)) > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "Enter a video or artist")
		return
	}
	if !s.youtubeSearchLimit.AllowContext(r.Context(), identity.ID) || !s.youtubeSearchBudget.AllowContext(r.Context(), "provider") {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "YouTube search is busy; try again later")
		return
	}
	result, err := (youtube.Client{APIKey: os.Getenv("YOUTUBE_API_KEY"), MaxResults: 10}).Search(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusBadGateway, "YOUTUBE_SEARCH_FAILED", "YouTube search is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
