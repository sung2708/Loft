package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"loft/backend/internal/domain"
)

func (p *Postgres) AuthAccountExists(ctx context.Context, userID string) (bool, error) {
	var exists bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)`, userID).Scan(&exists)
	return exists, err
}

// DeletedMemberName replaces a deleted member's name on messages that stay in
// other people's rooms.
const DeletedMemberName = "Deleted member"

func (p *Postgres) ProfileOverrides(ctx context.Context, userID string) (domain.ProfileOverrides, error) {
	var overrides domain.ProfileOverrides
	var custom *string
	err := p.pool.QueryRow(ctx, `SELECT custom_display_name, hide_avatar FROM profiles WHERE id = $1::uuid`, userID).Scan(&custom, &overrides.HideAvatar)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ProfileOverrides{}, nil
	}
	if err != nil {
		return domain.ProfileOverrides{}, err
	}
	if custom != nil {
		overrides.DisplayName = *custom
	}
	return overrides, nil
}

func (p *Postgres) AccountProfile(ctx context.Context, userID string) (domain.AccountProfile, error) {
	var profile domain.AccountProfile
	var avatar *string
	err := p.pool.QueryRow(ctx, `SELECT p.id, p.display_name, p.custom_display_name, p.avatar_url, p.hide_avatar, p.created_at, d.scheduled_for
		FROM profiles p LEFT JOIN account_deletions d ON d.user_id = p.id WHERE p.id = $1::uuid`, userID).Scan(
		&profile.ID, &profile.DisplayName, &profile.CustomDisplayName, &avatar, &profile.HideAvatar, &profile.CreatedAt, &profile.DeletionScheduledFor)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.AccountProfile{}, domain.ErrNotFound
	}
	if avatar != nil {
		profile.AvatarURL = *avatar
	}
	return profile, err
}

// UpdateProfileSettings stores the member's choices and applies them to the
// effective profile row at once, so admin views and new messages agree.
func (p *Postgres) UpdateProfileSettings(ctx context.Context, identity domain.Identity, settings domain.ProfileSettings) error {
	tag, err := p.pool.Exec(ctx, `UPDATE profiles SET custom_display_name = $2::text, hide_avatar = $3,
		display_name = COALESCE($2::text, $4::text), avatar_url = CASE WHEN $3 THEN NULL ELSE NULLIF($5, '') END, updated_at = NOW()
		WHERE id = $1::uuid`, identity.ID, settings.CustomDisplayName, settings.HideAvatar, identity.ProviderName, identity.ProviderAvatar)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ScheduleAccountDeletion keeps the first schedule when called twice, so a
// repeated request never extends or shortens the grace period.
func (p *Postgres) ScheduleAccountDeletion(ctx context.Context, userID string, at time.Time) (time.Time, error) {
	var scheduled time.Time
	err := p.pool.QueryRow(ctx, `INSERT INTO account_deletions (user_id, scheduled_for)
		SELECT $1::uuid, $2::timestamptz WHERE EXISTS (SELECT 1 FROM profiles WHERE id = $1::uuid)
		ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
		RETURNING scheduled_for`, userID, at).Scan(&scheduled)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, domain.ErrNotFound
	}
	return scheduled, err
}

func (p *Postgres) CancelAccountDeletion(ctx context.Context, userID string) error {
	tag, err := p.pool.Exec(ctx, `DELETE FROM account_deletions WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (p *Postgres) DueAccountDeletions(ctx context.Context, now time.Time, limit int) ([]domain.DueDeletion, error) {
	rows, err := p.pool.Query(ctx, `SELECT user_id::text, requested_at FROM account_deletions WHERE GREATEST(scheduled_for, retry_after) <= $1 ORDER BY GREATEST(scheduled_for, retry_after), user_id LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.DueDeletion])
}

func (p *Postgres) OwnedRoomIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT id::text FROM rooms WHERE owner_id = $1::uuid`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (p *Postgres) PostponeAccountDeletion(ctx context.Context, deletion domain.DueDeletion, until time.Time) error {
	_, err := p.pool.Exec(ctx, `UPDATE account_deletions SET retry_after = GREATEST(retry_after, $2) WHERE user_id = $1::uuid AND requested_at = $3`, deletion.UserID, until, deletion.RequestedAt)
	return err
}

// PurgeAccount removes a due account in one transaction: owned rooms (and
// their messages, boards and memberships through cascades), the member's
// name on messages in other rooms, feedback, and finally the auth user, which
// cascades to the profile and Supabase sessions. Moderation records, the
// audit log and reports are kept, as the privacy notice states.
func (p *Postgres) PurgeAccount(ctx context.Context, deletion domain.DueDeletion, now time.Time, fencedRooms []string) error {
	userID := deletion.UserID
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var due bool
	err = tx.QueryRow(ctx, `SELECT GREATEST(scheduled_for, retry_after) <= $2 FROM account_deletions WHERE user_id = $1::uuid AND requested_at = $3 FOR UPDATE`, userID, now, deletion.RequestedAt).Scan(&due)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !due) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	// The profile lock blocks new room inserts through rooms.owner_id's foreign key.
	if _, err := tx.Exec(ctx, `SELECT id FROM profiles WHERE id = $1::uuid FOR UPDATE`, userID); err != nil {
		return err
	}
	var suspended, unfenced bool
	err = tx.QueryRow(ctx, `SELECT
		EXISTS (SELECT 1 FROM account_bans WHERE user_id = $1::uuid AND (expires_at IS NULL OR expires_at > $2)),
		EXISTS (SELECT 1 FROM rooms WHERE owner_id = $1::uuid AND NOT (id::text = ANY(COALESCE($3::text[], '{}'))))`,
		userID, now, fencedRooms).Scan(&suspended, &unfenced)
	if err != nil {
		return err
	}
	if suspended {
		return domain.ErrAccountSuspended
	}
	if unfenced {
		return domain.ErrConflict
	}
	statements := []string{
		`DELETE FROM rooms WHERE owner_id = $1::uuid`,
		`UPDATE messages SET sender_display_name = '` + DeletedMemberName + `', sender_avatar_url = NULL WHERE sender_user_id = $1::uuid`,
		`UPDATE content_reports SET reporter_name = '` + DeletedMemberName + `' WHERE reporter_type = 'user' AND reporter_id = $1::uuid`,
		`DELETE FROM call_feedback WHERE identity_type = 'user' AND identity_id = $1::uuid`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return err
		}
	}
	tag, err := tx.Exec(ctx, `DELETE FROM auth.users WHERE id = $1::uuid`, userID)
	if err != nil {
		return fmt.Errorf("delete auth user: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return errors.New("account purge did not delete the auth user")
	}
	return tx.Commit(ctx)
}

func (p *Postgres) ExportAccount(ctx context.Context, userID string) (domain.AccountExport, error) {
	profile, err := p.AccountProfile(ctx, userID)
	if err != nil {
		return domain.AccountExport{}, err
	}
	export := domain.AccountExport{ExportedAt: time.Now().UTC(), Profile: profile}
	rows, err := p.pool.Query(ctx, `SELECT r.id::text, r.name, m.role::text, r.created_at FROM room_members m JOIN rooms r ON r.id = m.room_id
		WHERE m.user_id = $1::uuid ORDER BY r.created_at`, userID)
	if err != nil {
		return export, err
	}
	if export.Rooms, err = pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ExportedRoom]); err != nil {
		return export, err
	}
	rows, err = p.pool.Query(ctx, `SELECT room_id::text, CASE WHEN deleted_at IS NULL THEN content ELSE '' END, created_at, edited_at, deleted_at IS NOT NULL
		FROM messages WHERE sender_user_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, userID, domain.MaxExportedMessages)
	if err != nil {
		return export, err
	}
	if export.Messages, err = pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ExportedMessage]); err != nil {
		return export, err
	}
	rows, err = p.pool.Query(ctx, `SELECT room_id::text, rating::int, tags, created_at FROM call_feedback
		WHERE identity_type = 'user' AND identity_id = $1::uuid ORDER BY created_at`, userID)
	if err != nil {
		return export, err
	}
	if export.CallFeedback, err = pgx.CollectRows(rows, pgx.RowToStructByPos[domain.ExportedFeedback]); err != nil {
		return export, err
	}
	export.RecentRooms, err = p.ListRecentRooms(ctx, userID, 200)
	return export, err
}

// RecordRoomVisit is best effort bookkeeping for the member's recent list.
func (p *Postgres) RecordRoomVisit(ctx context.Context, userID, roomID string) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO room_visits (user_id, room_id) SELECT $1::uuid, $2::uuid
		WHERE EXISTS (SELECT 1 FROM profiles WHERE id = $1::uuid)
		ON CONFLICT (user_id, room_id) DO UPDATE SET last_visited_at = NOW(), hidden = FALSE`, userID, roomID)
	return err
}

// ListRecentRooms lists rooms the member entered or was approved into, other
// than their own, newest first. Ended rooms are left out.
func (p *Postgres) ListRecentRooms(ctx context.Context, userID string, limit int) ([]domain.RecentRoom, error) {
	rows, err := p.pool.Query(ctx, `WITH seen AS (
			SELECT room_id, last_visited_at AS at FROM room_visits WHERE user_id = $1::uuid AND NOT hidden
			UNION ALL
			SELECT m.room_id, m.joined_at FROM room_members m WHERE m.user_id = $1::uuid AND m.role = 'member'
				AND NOT EXISTS (SELECT 1 FROM room_visits v WHERE v.user_id = m.user_id AND v.room_id = m.room_id AND v.hidden)
		), latest AS (SELECT room_id, MAX(at) AS at FROM seen GROUP BY room_id)
		SELECT r.id, COALESCE(r.short_code, r.invite_code), r.name, r.owner_id, r.allow_guests, r.max_participants, r.is_locked, r.version,
			r.password_required, COALESCE(r.atmosphere, 'ambient'), COALESCE(r.accent, 'blue'), COALESCE(r.adaptive_media_background, true), r.created_at,
			COALESCE(p.display_name, ''), l.at
		FROM latest l JOIN rooms r ON r.id = l.room_id LEFT JOIN profiles p ON p.id = r.owner_id
		WHERE r.owner_id <> $1::uuid AND NOT EXISTS (SELECT 1 FROM room_endings e WHERE e.room_id = r.id)
		ORDER BY l.at DESC, r.id LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rooms := make([]domain.RecentRoom, 0)
	for rows.Next() {
		var room domain.RecentRoom
		if err := rows.Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version,
			&room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt, &room.OwnerName, &room.LastVisitedAt); err != nil {
			return nil, err
		}
		room.Room = domain.NormalizeRoomAppearance(room.Room)
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}

// ForgetRoomVisit hides a room from the recent list until the member enters
// it again. Approved membership is kept, so access is unchanged.
func (p *Postgres) ForgetRoomVisit(ctx context.Context, userID, roomID string) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO room_visits (user_id, room_id, hidden)
		SELECT $1::uuid, $2::uuid, TRUE WHERE EXISTS (SELECT 1 FROM rooms WHERE id = $2::uuid) AND EXISTS (SELECT 1 FROM profiles WHERE id = $1::uuid)
		ON CONFLICT (user_id, room_id) DO UPDATE SET hidden = TRUE`, userID, roomID)
	return err
}
