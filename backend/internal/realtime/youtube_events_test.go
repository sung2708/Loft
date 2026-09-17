package realtime

import (
	"encoding/json"
	"testing"
	"time"

	"loft/backend/internal/domain"
)

func TestValidateYouTubePickCommand(t *testing.T) {
	good, err := validateYouTubePickCommand(json.RawMessage(`{"video_id":"dQw4w9WgXcQ","title":"x"}`), true)
	if err != nil || good.VideoID == "" {
		t.Fatal(err)
	}
	if _, err := validateYouTubePickCommand(json.RawMessage(`{"video_id":"short"}`), true); err == nil {
		t.Fatal("short video id accepted")
	}
	if _, err := validateYouTubePickCommand(json.RawMessage(`{"title":"x"}`), false); err != nil {
		t.Fatal(err)
	}
}

func TestMediaEndedIdempotence(t *testing.T) {
	room := domain.Room{ID: "r1", OwnerID: "u1"}
	host := domain.Identity{ID: "u1", Type: domain.IdentityUser}
	member := domain.Identity{ID: "u2", Type: domain.IdentityUser}
	now := time.Now()

	m := mediaState{
		Current: &youtubeTrack{ID: "t1", VideoID: "dQw4w9WgXcQ", Title: "Never Gonna Give You Up"},
		Queue: []youtubeTrack{
			{ID: "t2", VideoID: "9bZkp7q19f0", Title: "Gangnam Style"},
		},
		Status:  "PLAYING",
		Version: 5,
	}

	// First ended report from member
	cmdPayload, _ := json.Marshal(mediaCommand{
		VideoID:         "dQw4w9WgXcQ",
		ExpectedVersion: 5,
	})
	if err := m.applyMedia("media.ended", cmdPayload, room, member, now); err != nil {
		t.Fatalf("first ended report failed: %v", err)
	}
	if m.Current == nil || m.Current.VideoID != "9bZkp7q19f0" {
		t.Fatalf("expected queue to advance to Gangnam Style, got %+v", m.Current)
	}
	if m.Version != 6 {
		t.Fatalf("expected version 6, got %d", m.Version)
	}

	// Duplicate/stale ended report from host with old version (5)
	if err := m.applyMedia("media.ended", cmdPayload, room, host, now); err != nil {
		t.Fatalf("duplicate ended report should return nil, got %v", err)
	}
	// Version and current should remain unchanged
	if m.Current.VideoID != "9bZkp7q19f0" || m.Version != 6 {
		t.Fatalf("state mutated on duplicate ended: version=%d current=%+v", m.Version, m.Current)
	}
}

func TestMediaUnavailableIdempotence(t *testing.T) {
	room := domain.Room{ID: "r1", OwnerID: "u1"}
	host := domain.Identity{ID: "u1", Type: domain.IdentityUser}
	now := time.Now()

	m := mediaState{
		Current: &youtubeTrack{ID: "t1", VideoID: "dQw4w9WgXcQ"},
		Queue: []youtubeTrack{
			{ID: "t2", VideoID: "9bZkp7q19f0"},
		},
		Status:  "PLAYING",
		Version: 3,
	}

	cmdPayload, _ := json.Marshal(mediaCommand{
		VideoID:         "dQw4w9WgXcQ",
		ExpectedVersion: 3,
	})
	if err := m.applyMedia("media.unavailable", cmdPayload, room, host, now); err != nil {
		t.Fatalf("unavailable failed: %v", err)
	}
	if m.Unavailable != "dQw4w9WgXcQ" || m.Current.VideoID != "9bZkp7q19f0" {
		t.Fatalf("unexpected state after unavailable: %+v", m)
	}

	// Stale unavailable for already skipped video should be idempotent
	if err := m.applyMedia("media.unavailable", cmdPayload, room, host, now); err != nil {
		t.Fatalf("duplicate unavailable should be idempotent: %v", err)
	}
}
