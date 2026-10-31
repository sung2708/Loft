package store

import (
	"context"
	"loft/backend/internal/domain"
)

func (p *Postgres) EndOwnedRoom(ctx context.Context, roomID, ownerID string) error {
	var owned bool
	err := p.pool.QueryRow(ctx, `WITH target AS (SELECT id FROM rooms WHERE id=$1 AND owner_id=$2), ended AS (INSERT INTO room_endings(room_id) SELECT id FROM target ON CONFLICT DO NOTHING RETURNING room_id) SELECT EXISTS(SELECT 1 FROM target)`, roomID, ownerID).Scan(&owned)
	if err != nil {
		return err
	}
	if !owned {
		return domain.ErrNotFound
	}
	return nil
}
