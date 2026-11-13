package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"loft/backend/internal/domain"
)

func (p *Postgres) ActiveAccountBan(ctx context.Context, userID string) (*domain.AccountBan, error) {
	var ban domain.AccountBan
	err := p.pool.QueryRow(ctx, `SELECT user_id, actor_id, reason, note, expires_at, created_at
		FROM account_bans WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`, userID).Scan(
		&ban.UserID, &ban.ActorID, &ban.Reason, &ban.Note, &ban.ExpiresAt, &ban.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ban, nil
}

// BanAccount upserts the suspension and records it in the audit log atomically.
func (p *Postgres) BanAccount(ctx context.Context, ban domain.AccountBan) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `INSERT INTO account_bans (user_id, actor_id, reason, note, expires_at)
		SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::timestamptz WHERE EXISTS (SELECT 1 FROM profiles WHERE id = $1::uuid)
		ON CONFLICT (user_id) DO UPDATE SET actor_id = EXCLUDED.actor_id, reason = EXCLUDED.reason,
			note = EXCLUDED.note, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
		ban.UserID, ban.ActorID, ban.Reason, ban.Note, ban.ExpiresAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, reason, note, expires_at)
		VALUES ($1::uuid, 'account.suspend', 'user', $2::text, $3::text, $4::text, $5::timestamptz)`, ban.ActorID, ban.UserID, ban.Reason, ban.Note, ban.ExpiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) LiftAccountBan(ctx context.Context, userID, actorID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM account_bans WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id)
		VALUES ($1::uuid, 'account.unsuspend', 'user', $2::text)`, actorID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const adminAuditFilter = `($1 = '' OR a.action = $1) AND ($2 = '' OR a.actor_id::text = $2) AND ($3 = '' OR a.target_id = $3)
	AND ($4::timestamptz IS NULL OR a.created_at >= $4) AND ($5::timestamptz IS NULL OR a.created_at < $5)`

func (p *Postgres) ListAdminAudit(ctx context.Context, filter domain.AdminAuditFilter, limit, offset int) ([]domain.AdminAuditEntry, int, error) {
	args := []any{filter.Action, filter.ActorID, filter.TargetID, filter.From, filter.To}
	var total int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM admin_audit_log a WHERE `+adminAuditFilter, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.pool.Query(ctx, `SELECT a.id, a.actor_id, COALESCE(p.display_name, ''), a.action, a.target_type, a.target_id,
		COALESCE(a.reason, ''), COALESCE(a.note, ''), a.expires_at, a.created_at
		FROM admin_audit_log a LEFT JOIN profiles p ON p.id = a.actor_id
		WHERE `+adminAuditFilter+`
		ORDER BY a.created_at DESC, a.id DESC LIMIT $6 OFFSET $7`, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	entries := make([]domain.AdminAuditEntry, 0, min(limit, 100))
	for rows.Next() {
		var e domain.AdminAuditEntry
		if err := rows.Scan(&e.ID, &e.ActorID, &e.ActorName, &e.Action, &e.TargetType, &e.TargetID, &e.Reason, &e.Note, &e.ExpiresAt, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}
