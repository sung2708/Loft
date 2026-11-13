package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"loft/backend/internal/domain"
)

type Postgres struct{ pool *pgxpool.Pool }

func (p *Postgres) AdminOverview(ctx context.Context) (domain.AdminOverview, error) {
	var overview domain.AdminOverview
	err := p.pool.QueryRow(ctx, `SELECT (SELECT COUNT(*) FROM profiles), (SELECT COUNT(*) FROM rooms),
        (SELECT COUNT(*) FROM rooms r WHERE NOT EXISTS (SELECT 1 FROM room_endings e WHERE e.room_id=r.id)),
        (SELECT COUNT(*) FROM room_endings),
        (SELECT COUNT(*) FROM profiles WHERE created_at >= now() - interval '7 days'),
        (SELECT COUNT(*) FROM rooms WHERE created_at >= now() - interval '7 days'),
        (SELECT COUNT(*) FROM content_reports WHERE status = 'open'),
        (SELECT COUNT(*) FROM account_bans WHERE expires_at IS NULL OR expires_at > now()),
        (SELECT COUNT(*) FROM account_deletions)`).Scan(&overview.Users, &overview.Rooms, &overview.OpenRooms, &overview.EndedRooms, &overview.NewUsers, &overview.NewRooms,
		&overview.OpenReports, &overview.SuspendedUsers, &overview.PendingDeletions)
	if err != nil {
		return overview, err
	}
	// Days are UTC calendar days; the last bucket is today so far.
	rows, err := p.pool.Query(ctx, `WITH bounds AS (
			SELECT (now() AT TIME ZONE 'UTC')::date AS today
		), days AS (
			SELECT today - n AS day FROM bounds CROSS JOIN generate_series(0, $1::int - 1) AS g(n)
		), signups AS (
			SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS total
			FROM profiles CROSS JOIN bounds
			WHERE created_at >= ((today - ($1::int - 1))::timestamp AT TIME ZONE 'UTC')
				AND created_at < ((today + 1)::timestamp AT TIME ZONE 'UTC')
			GROUP BY 1
		), created_rooms AS (
			SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS total
			FROM rooms CROSS JOIN bounds
			WHERE created_at >= ((today - ($1::int - 1))::timestamp AT TIME ZONE 'UTC')
				AND created_at < ((today + 1)::timestamp AT TIME ZONE 'UTC')
			GROUP BY 1
		)
		SELECT to_char(d.day, 'YYYY-MM-DD'), COALESCE(s.total, 0), COALESCE(r.total, 0)
		FROM days d LEFT JOIN signups s ON s.day = d.day LEFT JOIN created_rooms r ON r.day = d.day
		ORDER BY d.day`, domain.AdminTrendDays)
	if err != nil {
		return overview, err
	}
	overview.Daily, err = pgx.CollectRows(rows, pgx.RowToStructByPos[domain.AdminDailyCount])
	return overview, err
}

const adminUserFilter = `($1 = '' OR strpos(lower(p.display_name), $1) > 0 OR p.id::text = $1)
	AND ($2 = ''
		OR ($2 = 'suspended' AND EXISTS (SELECT 1 FROM account_bans s WHERE s.user_id = p.id AND (s.expires_at IS NULL OR s.expires_at > NOW())))
		OR ($2 = 'deleting' AND EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id = p.id))
		OR ($2 = 'reported' AND EXISTS (SELECT 1 FROM content_reports c WHERE c.target_type = 'user' AND c.target_id = p.id AND c.status = 'open')))`

const adminUserColumns = `p.id, p.display_name, p.created_at,
		(SELECT COUNT(*)::int FROM rooms r WHERE r.owner_id = p.id),
		b.actor_id, b.reason, b.note, b.expires_at, b.created_at,
		(SELECT d.scheduled_for FROM account_deletions d WHERE d.user_id = p.id),
		(SELECT COUNT(*)::int FROM content_reports c WHERE c.target_type = 'user' AND c.target_id = p.id AND c.status = 'open')`

func scanAdminUser(row rowScanner) (domain.AdminUser, error) {
	var user domain.AdminUser
	var actorID, reason, note *string
	var expiresAt, bannedAt *time.Time
	if err := row.Scan(&user.ID, &user.DisplayName, &user.CreatedAt, &user.RoomCount, &actorID, &reason, &note, &expiresAt, &bannedAt,
		&user.DeletionScheduledFor, &user.OpenReports); err != nil {
		return user, err
	}
	if actorID != nil && reason != nil && note != nil && bannedAt != nil {
		user.Suspension = &domain.AccountBan{UserID: user.ID, ActorID: *actorID, Reason: *reason, Note: *note, ExpiresAt: expiresAt, CreatedAt: *bannedAt}
	}
	return user, nil
}

func (p *Postgres) ListAdminUsers(ctx context.Context, query string, status domain.AdminUserStatus, limit, offset int) ([]domain.AdminUser, int, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	var total int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM profiles p WHERE `+adminUserFilter, query, status).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.pool.Query(ctx, `SELECT `+adminUserColumns+`
		FROM profiles p
		LEFT JOIN account_bans b ON b.user_id = p.id AND (b.expires_at IS NULL OR b.expires_at > NOW())
		WHERE `+adminUserFilter+`
		ORDER BY p.created_at DESC, p.id LIMIT $3 OFFSET $4`, query, status, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	users := make([]domain.AdminUser, 0)
	for rows.Next() {
		user, err := scanAdminUser(rows)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, user)
	}
	return users, total, rows.Err()
}

func (p *Postgres) AdminUserDetail(ctx context.Context, userID string) (domain.AdminUserDetail, error) {
	var detail domain.AdminUserDetail
	row := p.pool.QueryRow(ctx, `SELECT `+adminUserColumns+`, p.updated_at,
		(SELECT COUNT(*)::int FROM room_members m WHERE m.user_id = p.id AND m.role = 'member'),
		(SELECT COUNT(*)::int FROM messages m WHERE m.sender_user_id = p.id),
		(SELECT COUNT(*)::int FROM content_reports c WHERE c.target_type = 'user' AND c.target_id = p.id),
		(SELECT COUNT(*)::int FROM content_reports c WHERE c.reporter_type = 'user' AND c.reporter_id = p.id)
		FROM profiles p
		LEFT JOIN account_bans b ON b.user_id = p.id AND (b.expires_at IS NULL OR b.expires_at > NOW())
		WHERE p.id = $1::uuid`, userID)
	var actorID, reason, note *string
	var expiresAt, bannedAt *time.Time
	user := &detail.AdminUser
	err := row.Scan(&user.ID, &user.DisplayName, &user.CreatedAt, &user.RoomCount, &actorID, &reason, &note, &expiresAt, &bannedAt,
		&user.DeletionScheduledFor, &user.OpenReports, &detail.LastSeenAt, &detail.MemberRooms, &detail.MessagesSent, &detail.TotalReports, &detail.ReportsFiled)
	if errors.Is(err, pgx.ErrNoRows) {
		return detail, domain.ErrNotFound
	}
	if err != nil {
		return detail, err
	}
	if actorID != nil && reason != nil && note != nil && bannedAt != nil {
		user.Suspension = &domain.AccountBan{UserID: user.ID, ActorID: *actorID, Reason: *reason, Note: *note, ExpiresAt: expiresAt, CreatedAt: *bannedAt}
	}
	if detail.History, _, err = p.ListAdminAudit(ctx, domain.AdminAuditFilter{TargetID: userID}, 20, 0); err != nil {
		return detail, err
	}
	rows, err := p.pool.Query(ctx, `SELECT `+reportColumns+reportJoins+` WHERE c.target_type = 'user' AND c.target_id = $1::uuid ORDER BY c.created_at DESC, c.id DESC LIMIT 10`, userID)
	if err != nil {
		return detail, err
	}
	defer rows.Close()
	detail.RecentReports = make([]domain.Report, 0)
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return detail, err
		}
		detail.RecentReports = append(detail.RecentReports, report)
	}
	return detail, rows.Err()
}

func (p *Postgres) ListAdminRooms(ctx context.Context, query, status, owner string, limit, offset int) ([]domain.AdminRoom, int, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	source := ` FROM (SELECT r.id, r.short_code, r.invite_code, r.name, r.owner_id,
 r.allow_guests,r.is_locked,r.password_required,r.created_at,false AS deleted FROM rooms r
 UNION ALL SELECT m.room_id,NULL,NULL,'',NULL,false,false,false,m.created_at,true
 FROM room_moderation m WHERE NOT EXISTS(SELECT 1 FROM rooms r WHERE r.id=m.room_id)) r
 LEFT JOIN profiles p ON p.id=r.owner_id `
	where := `($1 = '' OR strpos(lower(r.name), $1) > 0 OR lower(r.short_code) = $1 OR lower(r.invite_code) = $1 OR r.id::text = $1 OR strpos(lower(p.display_name), $1) > 0)
        AND ($2 = '' OR ($2 IN ('open','ended') AND ($2 = 'ended') = (r.deleted OR EXISTS(SELECT 1 FROM room_endings e WHERE e.room_id=r.id))) OR ($2 = 'moderated' AND EXISTS(SELECT 1 FROM room_moderation m WHERE m.room_id=r.id)))
        AND ($3 = '' OR r.owner_id::text = $3)`
	var total int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*)`+source+` WHERE `+where, query, status, owner).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := p.pool.Query(ctx, `SELECT r.id, COALESCE(r.short_code, r.invite_code, ''), r.name, COALESCE(r.owner_id::text, ''), COALESCE(p.display_name, ''),
		r.allow_guests, r.is_locked, r.password_required,
		r.deleted OR EXISTS(SELECT 1 FROM room_endings e WHERE e.room_id=r.id), r.created_at, r.deleted, (SELECT row_to_json(m) FROM room_moderation m WHERE m.room_id=r.id)
		`+source+` WHERE `+where+` ORDER BY r.created_at DESC, r.id LIMIT $4 OFFSET $5`, query, status, owner, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	rooms := make([]domain.AdminRoom, 0)
	for rows.Next() {
		var room domain.AdminRoom
		var moderation []byte
		if err := rows.Scan(&room.ID, &room.Code, &room.Name, &room.OwnerID, &room.OwnerName, &room.AllowGuests, &room.IsLocked, &room.PasswordRequired, &room.Ended, &room.CreatedAt, &room.Deleted, &moderation); err != nil {
			return nil, 0, err
		}
		if len(moderation) > 0 {
			if err := json.Unmarshal(moderation, &room.Moderation); err != nil {
				return nil, 0, err
			}
		}
		rooms = append(rooms, room)
	}
	return rooms, total, rows.Err()
}

func (p *Postgres) CreateRoomPick(ctx context.Context, pick YouTubeRoomPick) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var lockedID string
	if err := tx.QueryRow(ctx, `SELECT id FROM rooms WHERE id=$1 FOR UPDATE`, pick.RoomID).Scan(&lockedID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO youtube_room_picks (id, room_id, video_id, title, channel, suggested_by, active, suggested_by_guest)
		SELECT $1, $2, $3, $4, $5, CASE WHEN $9 = 'guest' THEN NULL ELSE $6::uuid END, $7, CASE WHEN $9 = 'guest' THEN $6::uuid END
		WHERE (SELECT COUNT(*) FROM youtube_room_picks WHERE room_id = $2 AND active) < $8`,
		pick.ID, pick.RoomID, pick.VideoID, pick.Title, pick.Channel, pick.SuggestedBy, pick.Active, MaxActivePicks, pick.SuggestedByType)
	if err != nil {
		if isUniqueViolation(err) {
			return domain.ErrConflict
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPickCapacityReached
	}
	return tx.Commit(ctx)
}

func (p *Postgres) ListRoomPicks(ctx context.Context, roomID string) ([]YouTubeRoomPick, error) {
	rows, err := p.pool.Query(ctx, `SELECT p.id, p.room_id, p.video_id, p.title, p.channel, COALESCE(p.suggested_by, p.suggested_by_guest), p.active, p.created_at, COUNT(COALESCE(v.user_id, v.guest_id))::int AS votes
		FROM youtube_room_picks p
		LEFT JOIN youtube_room_pick_votes v ON v.pick_id = p.id
		WHERE p.room_id=$1 AND p.active
		GROUP BY p.id, p.room_id, p.video_id, p.title, p.channel, p.suggested_by, p.suggested_by_guest, p.active, p.created_at
		ORDER BY votes DESC, p.created_at ASC LIMIT 100`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var picks []YouTubeRoomPick
	for rows.Next() {
		var pick YouTubeRoomPick
		if err := rows.Scan(&pick.ID, &pick.RoomID, &pick.VideoID, &pick.Title, &pick.Channel, &pick.SuggestedBy, &pick.Active, &pick.CreatedAt, &pick.Votes); err != nil {
			return nil, err
		}
		picks = append(picks, pick)
	}
	return picks, rows.Err()
}

func (p *Postgres) ListRoomPickVoters(ctx context.Context, roomID string) (map[string][]string, error) {
	rows, err := p.pool.Query(ctx, `SELECT v.pick_id, COALESCE(v.user_id, v.guest_id) FROM youtube_room_pick_votes v JOIN youtube_room_picks p ON p.id = v.pick_id WHERE p.room_id=$1 AND p.active`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	voters := make(map[string][]string)
	for rows.Next() {
		var pickID, userID string
		if err := rows.Scan(&pickID, &userID); err != nil {
			return nil, err
		}
		voters[pickID] = append(voters[pickID], userID)
	}
	return voters, rows.Err()
}

func (p *Postgres) VoteRoomPick(ctx context.Context, roomID, pickID string, actor domain.Identity) (int, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	// Serialize votes with each other and with promotion; count after the insert.
	var id string
	if err = tx.QueryRow(ctx, `SELECT id FROM youtube_room_picks WHERE id=$1 AND room_id=$2 AND active FOR UPDATE`, pickID, roomID).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domain.ErrNotFound
		}
		return 0, err
	}
	if actor.Type != domain.IdentityUser && actor.Type != domain.IdentityGuest {
		return 0, domain.ErrUnauthorized
	}
	tag, err := tx.Exec(ctx, `INSERT INTO youtube_room_pick_votes(pick_id,user_id,guest_id)
 VALUES($1,CASE WHEN $3='user' THEN $2::uuid END,CASE WHEN $3='guest' THEN $2::uuid END) ON CONFLICT DO NOTHING`, pickID, actor.ID, actor.Type)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() == 0 {
		return 0, ErrAlreadyVoted
	}
	var votes int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM youtube_room_pick_votes WHERE pick_id=$1`, pickID).Scan(&votes); err != nil {
		return 0, err
	}
	return votes, tx.Commit(ctx)
}

const promoteRoomPickSQL = `UPDATE youtube_room_picks SET active=FALSE WHERE id=$1 AND room_id=$2 AND active`
const setAutoplaySQL = `INSERT INTO youtube_room_media_settings (room_id, autoplay_enabled, updated_by) VALUES ($1,$2,$3) ON CONFLICT (room_id) DO UPDATE SET autoplay_enabled=EXCLUDED.autoplay_enabled, updated_by=EXCLUDED.updated_by, updated_at=NOW()`

// The setting and selected pick describe one transition and must commit together.
func (p *Postgres) CommitYouTubeSelection(ctx context.Context, roomID string, settings *YouTubeMediaSettings, pickID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if settings != nil {
		if _, err = tx.Exec(ctx, setAutoplaySQL, roomID, settings.AutoplayEnabled, settings.UpdatedBy); err != nil {
			return err
		}
	}
	if pickID != "" {
		tag, err := tx.Exec(ctx, promoteRoomPickSQL, pickID, roomID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
	}
	var transactionID string
	if err := tx.QueryRow(ctx, `SELECT pg_current_xact_id()::text`).Scan(&transactionID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		if errors.Is(err, pgx.ErrTxCommitRollback) {
			return err
		}
		return &SelectionCommitPendingError{TransactionID: transactionID, Cause: err}
	}
	return nil
}

func (p *Postgres) PromoteRoomPick(ctx context.Context, roomID, pickID string) error {
	tag, err := p.pool.Exec(ctx, promoteRoomPickSQL, pickID, roomID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
func (p *Postgres) SetAutoplay(ctx context.Context, settings YouTubeMediaSettings) error {
	_, err := p.pool.Exec(ctx, setAutoplaySQL, settings.RoomID, settings.AutoplayEnabled, settings.UpdatedBy)
	return err
}
func (p *Postgres) GetMediaSettings(ctx context.Context, roomID string) (YouTubeMediaSettings, error) {
	var s YouTubeMediaSettings
	err := p.pool.QueryRow(ctx, `SELECT room_id, autoplay_enabled, COALESCE(updated_by::text,''), updated_at FROM youtube_room_media_settings WHERE room_id=$1`, roomID).Scan(&s.RoomID, &s.AutoplayEnabled, &s.UpdatedBy, &s.UpdatedAt)
	return s, err
}

func Open(ctx context.Context, databaseURL string) (*Postgres, error) {
	// pgxpool removes pool parameters; retain their parsed presence before that.
	connConfig, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	// Defaults suit the Supabase session pooler. Override per deployment with
	// pool_max_conns / pool_min_conns in DATABASE_URL. When pointing at the
	// transaction pooler (port 6543), also add default_query_exec_mode=exec,
	// because it does not support pgx's cached prepared statements.
	if _, present := connConfig.RuntimeParams["pool_max_conns"]; !present {
		config.MaxConns = 10
	}
	if _, present := connConfig.RuntimeParams["pool_min_conns"]; !present {
		config.MinConns = 1
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close() { p.pool.Close() }

func (p *Postgres) CheckReady(ctx context.Context) error {
	// Migration 000022 is required by the account sweeper and deletion flow.
	_, err := p.pool.Exec(ctx, accountDeletionReadinessSQL)
	return err
}

const accountDeletionReadinessSQL = `SELECT retry_after FROM account_deletions LIMIT 0`

func (p *Postgres) UpsertProfile(ctx context.Context, identity domain.Identity) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO profiles (id, display_name, avatar_url)
		VALUES ($1, $2, NULLIF($3, '')) ON CONFLICT (id) DO UPDATE
		SET display_name = COALESCE(profiles.custom_display_name, EXCLUDED.display_name),
		    avatar_url = CASE WHEN profiles.hide_avatar THEN NULL ELSE EXCLUDED.avatar_url END,
		    updated_at = NOW()`,
		identity.ID, identity.DisplayName, identity.AvatarURL)
	return err
}

func (p *Postgres) CreateRoom(ctx context.Context, params domain.CreateRoomParams) (domain.Room, error) {
	for attempt := 0; attempt < 5; attempt++ {
		room, err := p.createRoom(ctx, params)
		if !isUniqueViolation(err) || attempt == 4 {
			return room, err
		}
	}
	return domain.Room{}, domain.ErrConflict
}

func (p *Postgres) createRoom(ctx context.Context, params domain.CreateRoomParams) (domain.Room, error) {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domain.Room{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var room domain.Room
	err = tx.QueryRow(ctx, `INSERT INTO rooms (name, owner_id, allow_guests, password_required, password_verifier)
		VALUES ($1, $2, $3, ($4 <> ''), NULLIF($4, '')) RETURNING id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at`,
		params.Name, params.Owner.ID, params.AllowGuests, params.Password).Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if err != nil {
		return domain.Room{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'host')`, room.ID, params.Owner.ID); err != nil {
		return domain.Room{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Room{}, err
	}
	return domain.NormalizeRoomAppearance(room), nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (p *Postgres) GetRoom(ctx context.Context, identifier string) (domain.Room, error) {
	var room domain.Room
	var ended bool
	err := p.pool.QueryRow(ctx, `SELECT id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(password_verifier, ''), COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at, EXISTS(SELECT 1 FROM room_endings e WHERE e.room_id=rooms.id)
		FROM rooms WHERE id::text = $1 OR short_code = $1 OR invite_code = $1`, identifier).Scan(
		&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.PasswordVerifier, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt, &ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrNotFound
	}
	if err == nil && ended {
		return room, domain.ErrRoomEnded
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) ListOwnedRooms(ctx context.Context, userID string) ([]domain.Room, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at
		FROM rooms WHERE owner_id = $1 AND NOT EXISTS(SELECT 1 FROM room_endings e WHERE e.room_id=rooms.id) ORDER BY updated_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rooms := make([]domain.Room, 0)
	for rows.Next() {
		var room domain.Room
		if err := rows.Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt); err != nil {
			return nil, err
		}
		rooms = append(rooms, domain.NormalizeRoomAppearance(room))
	}
	return rooms, rows.Err()
}

func (p *Postgres) SetRoomLocked(ctx context.Context, roomID, ownerID string, expectedVersion int64, locked bool) (domain.Room, error) {
	var room domain.Room
	err := p.pool.QueryRow(ctx, `UPDATE rooms SET is_locked = $4, version = version + 1, updated_at = NOW()
		WHERE id = $1::uuid AND owner_id = $2::uuid AND version = $3
		RETURNING id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at`,
		roomID, ownerID, expectedVersion, locked).Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrConflict
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) SetRoomLockedByHost(ctx context.Context, roomID string, expectedVersion int64, locked bool) (domain.Room, error) {
	var room domain.Room
	err := p.pool.QueryRow(ctx, `UPDATE rooms SET is_locked = $3, version = version + 1, updated_at = NOW()
		WHERE id = $1::uuid AND version = $2
		RETURNING id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at`,
		roomID, expectedVersion, locked).Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrConflict
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) UpdateRoomAccess(ctx context.Context, roomID, ownerID string, expectedVersion int64, update domain.RoomAccessUpdate) (domain.Room, error) {
	var room domain.Room
	var verifier *string
	if update.PasswordEnabled {
		verifier = &update.Password
	}
	err := p.pool.QueryRow(ctx, `UPDATE rooms SET name=$4, allow_guests=$5, is_locked=$6,
		password_required=$7, password_verifier=$8, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND owner_id=$2::uuid AND version=$3
		RETURNING id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at`,
		roomID, ownerID, expectedVersion, update.Name, update.AllowGuests, update.Locked, update.PasswordEnabled, verifier).
		Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrConflict
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) IsRoomMember(ctx context.Context, roomID, userID string) (bool, error) {
	var exists bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id=$1::uuid AND user_id=$2::uuid)`, roomID, userID).Scan(&exists)
	return exists, err
}

func (p *Postgres) RequestRoomAccess(ctx context.Context, roomID string, identity domain.Identity) error {
	if err := p.UpsertProfile(ctx, identity); err != nil {
		return err
	}
	_, err := p.pool.Exec(ctx, `INSERT INTO room_join_requests (room_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, roomID, identity.ID)
	return err
}

func (p *Postgres) ListJoinRequests(ctx context.Context, roomID, ownerID string) ([]domain.JoinRequest, error) {
	rows, err := p.pool.Query(ctx, `SELECT r.user_id, p.display_name, COALESCE(p.avatar_url, ''), r.requested_at
		FROM room_join_requests r JOIN profiles p ON p.id=r.user_id JOIN rooms room ON room.id=r.room_id
		WHERE r.room_id=$1::uuid AND room.owner_id=$2::uuid ORDER BY r.requested_at ASC`, roomID, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	requests := make([]domain.JoinRequest, 0)
	for rows.Next() {
		var item domain.JoinRequest
		if err := rows.Scan(&item.UserID, &item.DisplayName, &item.AvatarURL, &item.RequestedAt); err != nil {
			return nil, err
		}
		requests = append(requests, item)
	}
	return requests, rows.Err()
}

func (p *Postgres) ResolveJoinRequest(ctx context.Context, roomID, ownerID, userID string, approve bool) error {
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM room_join_requests r JOIN rooms room ON room.id=r.room_id WHERE r.room_id=$1::uuid AND r.user_id=$2::uuid AND room.owner_id=$3::uuid)`, roomID, userID, ownerID).Scan(&exists); err != nil || !exists {
		if err == nil {
			return domain.ErrNotFound
		}
		return err
	}
	if approve {
		if _, err = tx.Exec(ctx, `INSERT INTO room_members (room_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'member') ON CONFLICT DO NOTHING`, roomID, userID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM room_join_requests WHERE room_id=$1::uuid AND user_id=$2::uuid`, roomID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) UpdateRoomAppearanceByHost(ctx context.Context, roomID string, expectedVersion int64, update domain.RoomAppearanceUpdate) (domain.Room, error) {
	if !update.Atmosphere.Valid() || !update.Accent.Valid() {
		return domain.Room{}, domain.ErrInvalidRoomAppearance
	}
	var room domain.Room
	err := p.pool.QueryRow(ctx, `UPDATE rooms SET atmosphere=$3, accent=$4, adaptive_media_background=$5, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND version=$2
		RETURNING id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at`,
		roomID, expectedVersion, update.Atmosphere, update.Accent, update.AdaptiveMediaBackground).
		Scan(&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrConflict
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) BanIdentity(ctx context.Context, roomID, ownerID string, identity domain.Identity) error {
	result, err := p.pool.Exec(ctx, `INSERT INTO room_bans (room_id, identity_type, identity_id, banned_by)
		SELECT id, $3::identity_type, $4::uuid, owner_id FROM rooms
		WHERE id = $1::uuid AND owner_id = $2::uuid
		ON CONFLICT (room_id, identity_type, identity_id) DO NOTHING`, roomID, ownerID, identity.Type, identity.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return domain.ErrConflict
	}
	return nil
}

func (p *Postgres) BanIdentityByHost(ctx context.Context, roomID string, identity domain.Identity) error {
	result, err := p.pool.Exec(ctx, `INSERT INTO room_bans (room_id, identity_type, identity_id, banned_by)
		SELECT id, $2::identity_type, $3::uuid, owner_id FROM rooms WHERE id = $1::uuid
		ON CONFLICT (room_id, identity_type, identity_id) DO NOTHING`, roomID, identity.Type, identity.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return domain.ErrConflict
	}
	return nil
}

func (p *Postgres) BanIdentityForHost(ctx context.Context, roomID string, identity domain.Identity, expiresAt time.Time) error {
	result, err := p.pool.Exec(ctx, `INSERT INTO room_bans (room_id, identity_type, identity_id, banned_by, expires_at)
		SELECT id, $2::identity_type, $3::uuid, owner_id, $4 FROM rooms WHERE id = $1::uuid
		ON CONFLICT (room_id, identity_type, identity_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`, roomID, identity.Type, identity.ID, expiresAt)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return domain.ErrConflict
	}
	return nil
}

func (p *Postgres) IsBanned(ctx context.Context, roomID string, identity domain.Identity) (bool, error) {
	var banned bool
	err := p.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM room_bans
		WHERE room_id = $1::uuid AND identity_type = $2::identity_type AND identity_id = $3::uuid
		AND (expires_at IS NULL OR expires_at > NOW()))`,
		roomID, identity.Type, identity.ID).Scan(&banned)
	return banned, err
}

func (p *Postgres) DeleteOwnedRoom(ctx context.Context, roomID, ownerID string) error {
	result, err := p.pool.Exec(ctx, `DELETE FROM rooms WHERE id = $1::uuid AND owner_id = $2::uuid`, roomID, ownerID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (p *Postgres) InsertMessage(ctx context.Context, roomID string, identity domain.Identity, content string) (domain.Message, error) {
	return p.InsertMessageReply(ctx, roomID, identity, content, "")
}

// messageColumns projects a message plus its quoted parent. Deleted rows never
// expose their text; the original stays in message_revisions for moderation.
const messageColumns = `m.id, m.room_id, COALESCE(m.sender_user_id, m.sender_guest_id), m.sender_type,
	m.sender_display_name, COALESCE(m.sender_avatar_url, ''),
	CASE WHEN m.deleted_at IS NULL THEN m.content ELSE '' END, m.created_at, m.edited_at, m.deleted_at IS NOT NULL, m.revision,
	parent.id, parent.sender_display_name, parent.revision,
	CASE WHEN parent.deleted_at IS NULL THEN left(parent.content, 140) ELSE '' END, parent.deleted_at IS NOT NULL`

type rowScanner interface{ Scan(...any) error }

func scanMessage(row rowScanner) (domain.Message, error) {
	var message domain.Message
	var parentID, parentName, parentContent *string
	var parentDeleted *bool
	var parentRevision *uint64
	err := row.Scan(&message.ID, &message.RoomID, &message.SenderID, &message.SenderType,
		&message.SenderDisplayName, &message.SenderAvatarURL, &message.Content, &message.CreatedAt,
		&message.EditedAt, &message.Deleted, &message.Revision, &parentID, &parentName, &parentRevision, &parentContent, &parentDeleted)
	if err != nil {
		return message, err
	}
	if parentID != nil {
		reply := &domain.MessageReply{ID: *parentID}
		if parentRevision != nil {
			reply.Revision = *parentRevision
		}
		if parentName != nil {
			reply.SenderDisplayName = *parentName
		}
		if parentContent != nil {
			reply.Content = *parentContent
		}
		if parentDeleted != nil {
			reply.Deleted = *parentDeleted
		}
		message.ReplyTo = reply
	}
	return message, nil
}

// lockOpenRoom serializes writes with room closure.
func lockOpenRoom(ctx context.Context, tx pgx.Tx, roomID string) error {
	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM rooms WHERE id=$1 FOR UPDATE`, roomID).Scan(&id); err != nil {
		return err
	}
	var ended bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM room_endings WHERE room_id=$1)`, roomID).Scan(&ended); err != nil {
		return err
	}
	if ended {
		return domain.ErrRoomEnded
	}
	return nil
}

func getMessageTx(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, roomID, messageID string) (domain.Message, error) {
	message, err := scanMessage(q.QueryRow(ctx, `SELECT `+messageColumns+`
		FROM messages m LEFT JOIN messages parent ON parent.id = m.reply_to_id
		WHERE m.id = $1 AND m.room_id = $2`, messageID, roomID))
	if errors.Is(err, pgx.ErrNoRows) {
		return message, domain.ErrNotFound
	}
	return message, err
}

func (p *Postgres) InsertMessageReply(ctx context.Context, roomID string, identity domain.Identity, content, replyToID string) (domain.Message, error) {
	var message domain.Message
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return message, err
	}
	defer tx.Rollback(ctx)
	if err = lockOpenRoom(ctx, tx, roomID); err != nil {
		return message, err
	}
	if replyToID != "" {
		// A reply must target a message in the same room.
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND room_id=$2)`, replyToID, roomID).Scan(&exists); err != nil {
			return message, err
		}
		if !exists {
			return message, domain.ErrNotFound
		}
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO messages
		(room_id, sender_user_id, sender_guest_id, sender_type, sender_display_name, sender_avatar_url, content, reply_to_id)
		VALUES ($1, CASE WHEN $2 = 'user' THEN $3::uuid END, CASE WHEN $2 = 'guest' THEN $3::uuid END, $2::identity_type, $4, CASE WHEN $2 = 'user' AND EXISTS (SELECT 1 FROM profiles WHERE id = $3::uuid AND hide_avatar)
			THEN NULL ELSE NULLIF($5, '') END, $6, NULLIF($7, '')::uuid)
		RETURNING id`,
		roomID, identity.Type, identity.ID, identity.DisplayName, identity.AvatarURL, content, replyToID).Scan(&id)
	if err != nil {
		return message, err
	}
	if message, err = getMessageTx(ctx, tx, roomID, id); err != nil {
		return message, err
	}
	return message, tx.Commit(ctx)
}

func (p *Postgres) GetMessage(ctx context.Context, roomID, messageID string) (domain.Message, error) {
	return getMessageTx(ctx, p.pool, roomID, messageID)
}

// reviseMessage records the previous text, then applies an edit or soft delete.
// Authorization is decided by the domain layer before calling.
func (p *Postgres) reviseMessage(ctx context.Context, roomID, messageID string, actor domain.Identity, action, content string) (domain.Message, error) {
	var message domain.Message
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return message, err
	}
	defer tx.Rollback(ctx)
	if err = lockOpenRoom(ctx, tx, roomID); err != nil {
		return message, err
	}
	var previous string
	err = tx.QueryRow(ctx, `SELECT content FROM messages WHERE id=$1 AND room_id=$2 AND deleted_at IS NULL FOR UPDATE`, messageID, roomID).Scan(&previous)
	if errors.Is(err, pgx.ErrNoRows) {
		return message, domain.ErrNotFound
	}
	if err != nil {
		return message, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO message_revisions (message_id, action, previous_content, actor_type, actor_id)
		VALUES ($1, $2, $3, $4::identity_type, $5::uuid)`, messageID, action, previous, actor.Type, actor.ID); err != nil {
		return message, err
	}
	if action == "edit" {
		_, err = tx.Exec(ctx, `UPDATE messages SET content=$2, edited_at=NOW(), revision=revision+1 WHERE id=$1`, messageID, content)
	} else {
		_, err = tx.Exec(ctx, `UPDATE messages SET deleted_at=NOW(), revision=revision+1 WHERE id=$1`, messageID)
	}
	if err != nil {
		return message, err
	}
	if message, err = getMessageTx(ctx, tx, roomID, messageID); err != nil {
		return message, err
	}
	return message, tx.Commit(ctx)
}

func (p *Postgres) EditMessage(ctx context.Context, roomID, messageID string, actor domain.Identity, content string) (domain.Message, error) {
	return p.reviseMessage(ctx, roomID, messageID, actor, "edit", content)
}

func (p *Postgres) DeleteMessage(ctx context.Context, roomID, messageID string, actor domain.Identity) (domain.Message, error) {
	return p.reviseMessage(ctx, roomID, messageID, actor, "delete", "")
}

func (p *Postgres) RecentMessages(ctx context.Context, roomID string, limit int) ([]domain.Message, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	// Newest first for the LIMIT, reversed below to chronological order.
	rows, err := p.pool.Query(ctx, `SELECT `+messageColumns+`
		FROM messages m LEFT JOIN messages parent ON parent.id = m.reply_to_id
		WHERE m.room_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, roomID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]domain.Message, 0, limit)
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
	return messages, nil
}
