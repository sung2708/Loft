package store

import (
	"context"
	"time"

	"loft/backend/internal/domain"
)

func (p *Postgres) InsertCallFeedback(ctx context.Context, f domain.CallFeedback) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO call_feedback
		(room_id, identity_type, identity_id, rating, tags, duration_seconds, samples_good, samples_poor, samples_lost, reconnects)
		VALUES ($1, $2::identity_type, $3::uuid, $4, $5, $6, $7, $8, $9, $10)`,
		f.RoomID, f.Identity.Type, f.Identity.ID, f.Rating, f.Tags, f.DurationSeconds, f.SamplesGood, f.SamplesPoor, f.SamplesLost, f.Reconnects)
	return err
}

func (p *Postgres) CallQualitySummary(ctx context.Context, since time.Time) (domain.CallQualitySummary, error) {
	summary := domain.CallQualitySummary{Tags: map[string]int{}}
	var good, poor, lost int64
	err := p.pool.QueryRow(ctx, `SELECT COUNT(*)::int, COALESCE(AVG(rating), 0)::float8,
		COUNT(*) FILTER (WHERE rating <= 2)::int,
		COALESCE(SUM(samples_good), 0), COALESCE(SUM(samples_poor), 0), COALESCE(SUM(samples_lost), 0)
		FROM call_feedback WHERE created_at >= $1`, since).Scan(
		&summary.Responses, &summary.AverageRating, &summary.LowRatings, &good, &poor, &lost)
	if err != nil {
		return summary, err
	}
	if total := good + poor + lost; total > 0 {
		summary.PoorShare = float64(poor+lost) / float64(total)
	}
	rows, err := p.pool.Query(ctx, `SELECT tag, COUNT(*)::int FROM call_feedback, unnest(tags) AS tag
		WHERE created_at >= $1 GROUP BY tag`, since)
	if err != nil {
		return summary, err
	}
	defer rows.Close()
	for rows.Next() {
		var tag string
		var count int
		if err := rows.Scan(&tag, &count); err != nil {
			return summary, err
		}
		summary.Tags[tag] = count
	}
	return summary, rows.Err()
}
