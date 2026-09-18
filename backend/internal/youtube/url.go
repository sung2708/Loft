package youtube

import (
	"errors"
	"net/url"
	"strings"
)

var ErrInvalidURL = errors.New("invalid YouTube URL")

// VideoID normalizes only HTTPS YouTube URLs accepted by the room queue.
func VideoID(raw string) (string, error) {
	if len(raw) > 2048 {
		return "", ErrInvalidURL
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return "", ErrInvalidURL
	}
	host := strings.ToLower(u.Hostname())
	var id string
	switch host {
	case "youtube.com", "www.youtube.com", "m.youtube.com":
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		} else if strings.HasPrefix(u.Path, "/shorts/") {
			id = strings.TrimPrefix(u.Path, "/shorts/")
		}
	case "youtu.be":
		id = strings.TrimPrefix(u.Path, "/")
	default:
		return "", ErrInvalidURL
	}
	if !ValidVideoID(id) {
		return "", ErrInvalidURL
	}
	return id, nil
}

// ValidVideoID accepts only the fixed-width identifier format used by YouTube.
// Keep this separate from URL parsing because realtime and REST room-pick
// commands receive an ID, while the media queue receives a full URL.
func ValidVideoID(id string) bool {
	if len(id) != 11 {
		return false
	}
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
