package store

import (
	"context"
	"loft/backend/internal/domain"
)

func (p *Postgres) EndOwnedRoom(ctx context.Context, roomID, ownerID string) error {
	var owned bool
	err := p.pool.QueryRow(ctx, `WITH target AS (SELECT id FROM rooms WHERE id=$1 AND owner_id=$2 FOR UPDATE), ended AS (INSERT INTO room_endings(room_id) SELECT id FROM target ON CONFLICT DO NOTHING RETURNING room_id) SELECT EXISTS(SELECT 1 FROM target)`, roomID, ownerID).Scan(&owned)
	if err != nil {
		return err
	}
	if !owned {
		return domain.ErrNotFound
	}
	return nil
}

func (p *Postgres) ModerateRoom(ctx context.Context, roomID, actorID, reason, note string) error {
	var exists bool
	err := p.pool.QueryRow(ctx, `WITH target AS (SELECT id FROM rooms WHERE id=$1 FOR UPDATE),
 decision AS (INSERT INTO room_moderation(room_id,actor_id,reason,note) SELECT id,$2,$3,$4 FROM target ON CONFLICT DO NOTHING),
 ending AS (INSERT INTO room_endings(room_id) SELECT id FROM target ON CONFLICT DO NOTHING),
 audit AS (INSERT INTO admin_audit_log(actor_id,action,target_type,target_id,reason,note) SELECT $2,'room.end','room',id::text,$3,$4 FROM target)
 SELECT EXISTS(SELECT 1 FROM target)`, roomID, actorID, reason, note).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return domain.ErrNotFound
	}
	return nil
}
