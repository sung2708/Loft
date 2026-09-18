package realtime

import (
	"encoding/json"
	"fmt"

	"loft/backend/internal/youtube"
)

type youtubePickCommand struct {
	PickID          string `json:"pick_id,omitempty"`
	VideoID         string `json:"video_id,omitempty"`
	Title           string `json:"title,omitempty"`
	Channel         string `json:"channel,omitempty"`
	ExpectedVersion uint64 `json:"expected_version,omitempty"`
}

type youtubeRoomPick struct {
	ID          string              `json:"id"`
	VideoID     string              `json:"video_id"`
	Title       string              `json:"title"`
	Channel     string              `json:"channel"`
	SuggestedBy string              `json:"suggested_by"`
	Votes       int                 `json:"votes"`
	Voters      map[string]struct{} `json:"-"`
}

func validateYouTubePickCommand(raw json.RawMessage, requireVideo bool) (youtubePickCommand, error) {
	var cmd youtubePickCommand
	if len(raw) == 0 || json.Unmarshal(raw, &cmd) != nil {
		return cmd, fmt.Errorf("invalid youtube pick payload")
	}
	if requireVideo && !youtube.ValidVideoID(cmd.VideoID) {
		return cmd, fmt.Errorf("invalid youtube video id")
	}
	if len(cmd.Title) > 140 || len(cmd.Channel) > 80 || len(cmd.PickID) > 64 {
		return cmd, fmt.Errorf("youtube pick field too long")
	}
	return cmd, nil
}
