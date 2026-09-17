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
	if _, err := s.authenticatedUser(r); err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len([]rune(q)) > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "Enter a video or artist")
		return
	}
	result, err := (youtube.Client{APIKey: os.Getenv("YOUTUBE_API_KEY"), MaxResults: 10}).Search(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusBadGateway, "YOUTUBE_SEARCH_FAILED", "YouTube search is temporarily unavailable")
		return
	}
	writeJSON(w, http.StatusOK, result)
}
