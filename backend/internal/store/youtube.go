package store

import (
	"context"
	"errors"
	"time"
)

const MaxActivePicks = 50

var (
	ErrPickCapacityReached = errors.New("youtube pick capacity reached")
	ErrAlreadyVoted        = errors.New("youtube pick already voted")
)

type YouTubeRoomPick struct {
	ID          string
	RoomID      string
	VideoID     string
	Title       string
	Channel     string
	SuggestedBy string
	Active      bool
	Votes       int
	CreatedAt   time.Time
}

type YouTubeMediaSettings struct {
	RoomID          string
	AutoplayEnabled bool
	UpdatedBy       string
	UpdatedAt       time.Time
}

// YouTubeRepository is the durable boundary for picks/votes/settings. It never
// exposes provider credentials or arbitrary embed markup to room snapshots.
type YouTubeRepository interface {
	CreateRoomPick(context.Context, YouTubeRoomPick) error
	ListRoomPicks(context.Context, string) ([]YouTubeRoomPick, error)
	ListRoomPickVoters(context.Context, string) (map[string][]string, error)
	VoteRoomPick(ctx context.Context, roomID, pickID, userID string) error
	PromoteRoomPick(ctx context.Context, roomID, pickID string) error
	SetAutoplay(context.Context, YouTubeMediaSettings) error
	GetMediaSettings(context.Context, string) (YouTubeMediaSettings, error)
}
