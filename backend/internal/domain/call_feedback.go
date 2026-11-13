package domain

import (
	"context"
	"errors"
	"time"
)

var ErrInvalidFeedback = errors.New("invalid call feedback")

var callFeedbackTags = map[string]struct{}{
	"echo": {}, "choppy_audio": {}, "frozen_video": {}, "lag": {}, "disconnects": {}, "other": {},
}

// CallFeedback is a post-call rating with coarse quality samples collected by
// the client (one sample every few seconds of LiveKit connection quality).
type CallFeedback struct {
	RoomID          string   `json:"-"`
	Identity        Identity `json:"-"`
	Rating          int      `json:"rating"`
	Tags            []string `json:"tags"`
	DurationSeconds int      `json:"duration_seconds"`
	SamplesGood     int      `json:"samples_good"`
	SamplesPoor     int      `json:"samples_poor"`
	SamplesLost     int      `json:"samples_lost"`
	Reconnects      int      `json:"reconnects"`
}

// Validate normalizes tags (deduplicated, known values only) and bounds counters.
func (f *CallFeedback) Validate() error {
	if f.Rating < 1 || f.Rating > 5 || f.DurationSeconds < 0 || f.DurationSeconds > 86400 ||
		f.Reconnects < 0 || f.Reconnects > 1000 || len(f.Tags) > len(callFeedbackTags) {
		return ErrInvalidFeedback
	}
	for _, samples := range []int{f.SamplesGood, f.SamplesPoor, f.SamplesLost} {
		if samples < 0 || samples > 20000 {
			return ErrInvalidFeedback
		}
	}
	seen := make(map[string]struct{}, len(f.Tags))
	tags := make([]string, 0, len(f.Tags))
	for _, tag := range f.Tags {
		if _, ok := callFeedbackTags[tag]; !ok {
			return ErrInvalidFeedback
		}
		if _, dup := seen[tag]; !dup {
			seen[tag] = struct{}{}
			tags = append(tags, tag)
		}
	}
	f.Tags = tags
	return nil
}

type CallQualitySummary struct {
	Responses     int            `json:"responses"`
	AverageRating float64        `json:"average_rating"`
	LowRatings    int            `json:"low_ratings"`
	PoorShare     float64        `json:"poor_share"`
	Tags          map[string]int `json:"tags"`
}

type CallFeedbackStore interface {
	InsertCallFeedback(context.Context, CallFeedback) error
	CallQualitySummary(ctx context.Context, since time.Time) (CallQualitySummary, error)
}
