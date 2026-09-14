package realtime

import (
	"encoding/json"
	"errors"
	"math/rand"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"loft/backend/internal/domain"
)

type youtubeTrack struct {
	ID          string `json:"id"`
	VideoID     string `json:"video_id"`
	AddedBy     string `json:"added_by"`
	Title       string `json:"title,omitempty"`
	Channel     string `json:"channel,omitempty"`
	DurationSec int64  `json:"duration_sec,omitempty"`
}

type mediaState struct {
	Current    *youtubeTrack  `json:"current"`
	Queue      []youtubeTrack `json:"queue"`
	Repeat     bool           `json:"repeat"`
	Status     string         `json:"status"`
	PositionMs int64          `json:"position_ms"`
	StartedAt  time.Time      `json:"started_at"`
	Version    uint64         `json:"version"`
}

type mediaCommand struct {
	URL             string   `json:"url"`
	TrackID         string   `json:"track_id"`
	Order           []string `json:"order"`
	Title           string   `json:"title"`
	Channel         string   `json:"channel"`
	DurationSec     int64    `json:"duration_sec"`
	VideoID         string   `json:"video_id"`
	Repeat          bool     `json:"repeat"`
	PositionMs      int64    `json:"position_ms"`
	ExpectedVersion uint64   `json:"expected_version"`
}

var (
	errInvalidMedia = errors.New("invalid YouTube link or command")
	errMediaDenied  = errors.New("media permission denied")
	errMediaStale   = errors.New("media state changed; retry")
	errQueueFull    = errors.New("queue is full")
)

func parseYouTubeID(raw string) (string, error) {
	if len(raw) > 2048 {
		return "", errInvalidMedia
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return "", errInvalidMedia
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
	}
	if len(id) != 11 {
		return "", errInvalidMedia
	}
	for _, char := range id {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') && char != '-' && char != '_' {
			return "", errInvalidMedia
		}
	}
	return id, nil
}

func (m mediaState) snapshot() mediaState {
	m.Queue = append([]youtubeTrack{}, m.Queue...)
	if m.Current != nil {
		current := *m.Current
		m.Current = &current
	}
	return m
}

// applyMedia mutates only room-owned in-memory state. Caller holds the hub mutex;
// no network or database I/O is performed here.
func (m *mediaState) applyMedia(kind string, raw json.RawMessage, room domain.Room, actor domain.Identity, now time.Time) error {
	var command mediaCommand
	if len(raw) == 0 || json.Unmarshal(raw, &command) != nil {
		return errInvalidMedia
	}
	if kind == "queue.add" {
		if !domain.CanManageQueue(room, actor) {
			return errMediaDenied
		}
		id, err := parseYouTubeID(command.URL)
		if err != nil {
			return err
		}
		if len(m.Queue) >= 50 {
			return errQueueFull
		}
		title := strings.TrimSpace(command.Title)
		if len(title) > 140 {
			title = title[:140]
		}
		channel := strings.TrimSpace(command.Channel)
		if len(channel) > 80 {
			channel = channel[:80]
		}
		track := youtubeTrack{
			ID:          uuid.NewString(),
			VideoID:     id,
			AddedBy:     actor.DisplayName,
			Title:       title,
			Channel:     channel,
			DurationSec: 0,
		}
		if m.Current == nil {
			m.Current = &track
			m.Status = "PAUSED"
		} else {
			m.Queue = append(m.Queue, track)
		}
		m.Version++
		return nil
	}
	if kind == "queue.next" || kind == "queue.select" || strings.HasPrefix(kind, "media.") {
		if !domain.CanControlMedia(room, actor) {
			return errMediaDenied
		}
	} else if strings.HasPrefix(kind, "queue.") {
		if !domain.CanManageQueue(room, actor) {
			return errMediaDenied
		}
	} else {
		return errInvalidMedia
	}
	if command.ExpectedVersion != m.Version {
		return errMediaStale
	}
	switch kind {
	case "media.play":
		if m.Current == nil {
			return errInvalidMedia
		}
		if m.Status != "PLAYING" {
			m.Status = "PLAYING"
			m.StartedAt = now
		}
	case "media.pause":
		if m.Current == nil {
			return errInvalidMedia
		}
		if m.Status != "PAUSED" {
			m.PositionMs += now.Sub(m.StartedAt).Milliseconds()
			m.Status = "PAUSED"
			m.StartedAt = time.Time{}
		}
	case "media.seek":
		if m.Current == nil || command.PositionMs < 0 || command.PositionMs > 24*60*60*1000 {
			return errInvalidMedia
		}
		m.PositionMs = command.PositionMs
		if m.Status == "PLAYING" {
			m.StartedAt = now
		}
	case "media.duration":
		if m.Current == nil || command.VideoID != m.Current.VideoID || command.DurationSec < 1 || command.DurationSec > 24*60*60 {
			return errInvalidMedia
		}
		m.Current.DurationSec = command.DurationSec
	case "media.repeat":
		m.Repeat = command.Repeat
	case "queue.next":
		if m.Current == nil {
			return errInvalidMedia
		}
		m.advance(now)
	case "queue.select":
		if command.TrackID == "" {
			return errInvalidMedia
		}
		idx := -1
		for i, t := range m.Queue {
			if t.ID == command.TrackID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return errInvalidMedia
		}
		selected := m.Queue[idx]
		m.Queue = append(m.Queue[:idx], m.Queue[idx+1:]...)
		m.Current = &selected
		m.PositionMs = 0
		m.StartedAt = now
		m.Status = "PLAYING"
	case "queue.remove":
		if command.TrackID == "" {
			return errInvalidMedia
		}
		idx := -1
		for i, t := range m.Queue {
			if t.ID == command.TrackID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return errInvalidMedia
		}
		m.Queue = append(m.Queue[:idx], m.Queue[idx+1:]...)
	case "queue.clear":
		m.Queue = []youtubeTrack{}
	case "queue.shuffle":
		if len(m.Queue) > 1 {
			r := rand.New(rand.NewSource(now.UnixNano()))
			r.Shuffle(len(m.Queue), func(i, j int) {
				m.Queue[i], m.Queue[j] = m.Queue[j], m.Queue[i]
			})
		}
	case "queue.reorder":
		if len(command.Order) != len(m.Queue) {
			return errInvalidMedia
		}
		idMap := make(map[string]youtubeTrack, len(m.Queue))
		for _, t := range m.Queue {
			idMap[t.ID] = t
		}
		newQueue := make([]youtubeTrack, 0, len(m.Queue))
		for _, id := range command.Order {
			t, exists := idMap[id]
			if !exists {
				return errInvalidMedia
			}
			newQueue = append(newQueue, t)
			delete(idMap, id)
		}
		m.Queue = newQueue
	default:
		return errInvalidMedia
	}
	m.Version++
	return nil
}

func (m *mediaState) advance(now time.Time) {
	if len(m.Queue) == 0 {
		m.Current = nil
		m.Status = "IDLE"
		m.PositionMs = 0
		m.StartedAt = time.Time{}
		return
	}
	next := m.Queue[0]
	m.Current = &next
	m.Queue = m.Queue[1:]
	m.Status = "PLAYING"
	m.PositionMs = 0
	m.StartedAt = now
}

func (m *mediaState) finish(now time.Time) bool {
	if m.Current == nil || m.Status != "PLAYING" || m.Current.DurationSec <= 0 {
		return false
	}
	if m.PositionMs+now.Sub(m.StartedAt).Milliseconds() < m.Current.DurationSec*1000 {
		return false
	}
	if m.Repeat {
		m.PositionMs = 0
		m.StartedAt = now
	} else {
		m.advance(now)
	}
	m.Version++
	return true
}
