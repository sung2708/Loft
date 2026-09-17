package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"loft/backend/internal/domain"
	"loft/backend/internal/spotify"
)

type Postgres struct{ pool *pgxpool.Pool }

func (p *Postgres) SaveSpotifyCredentials(ctx context.Context, c spotify.Credentials, accessCiphertext, refreshCiphertext string) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO spotify_connections (user_id, access_token_ciphertext, refresh_token_ciphertext, scopes, expires_at, revoked_at)
		VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET access_token_ciphertext=EXCLUDED.access_token_ciphertext, refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext, scopes=EXCLUDED.scopes, expires_at=EXCLUDED.expires_at, revoked_at=EXCLUDED.revoked_at, updated_at=NOW()`, c.UserID, accessCiphertext, refreshCiphertext, c.Scopes, c.ExpiresAt, c.RevokedAt)
	return err
}

func (p *Postgres) LoadSpotifyCredentials(ctx context.Context, userID string) (accessCiphertext, refreshCiphertext string, scopes []string, expiresAt time.Time, revokedAt *time.Time, err error) {
	err = p.pool.QueryRow(ctx, `SELECT access_token_ciphertext, refresh_token_ciphertext, scopes, expires_at, revoked_at FROM spotify_connections WHERE user_id=$1`, userID).Scan(&accessCiphertext, &refreshCiphertext, &scopes, &expiresAt, &revokedAt)
	return
}

func (p *Postgres) RevokeSpotifyCredentials(ctx context.Context, userID string, at time.Time) error {
	_, err := p.pool.Exec(ctx, `UPDATE spotify_connections SET revoked_at=$2, updated_at=NOW() WHERE user_id=$1`, userID, at)
	return err
}

func (p *Postgres) UpdateSpotifyTokens(ctx context.Context, userID, accessCiphertext, refreshCiphertext string, expiresAt time.Time) error {
	_, err := p.pool.Exec(ctx, `UPDATE spotify_connections SET access_token_ciphertext=$2, refresh_token_ciphertext=$3, expires_at=$4, revoked_at=NULL, updated_at=NOW() WHERE user_id=$1`, userID, accessCiphertext, refreshCiphertext, expiresAt)
	return err
}

func (p *Postgres) DisconnectSpotify(ctx context.Context, userID string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM spotify_connections WHERE user_id=$1`, userID)
	return err
}

func (p *Postgres) CreateRoomPick(ctx context.Context, pick YouTubeRoomPick) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO youtube_room_picks (id, room_id, video_id, title, channel, suggested_by, active) VALUES ($1,$2,$3,$4,$5,$6,$7)`, pick.ID, pick.RoomID, pick.VideoID, pick.Title, pick.Channel, pick.SuggestedBy, pick.Active)
	return err
}

func (p *Postgres) ListRoomPicks(ctx context.Context, roomID string) ([]YouTubeRoomPick, error) {
	rows, err := p.pool.Query(ctx, `SELECT p.id, p.room_id, p.video_id, p.title, p.channel, p.suggested_by, p.active, p.created_at, COALESCE(COUNT(v.user_id), 0)::int AS votes
		FROM youtube_room_picks p
		LEFT JOIN youtube_room_pick_votes v ON v.pick_id = p.id
		WHERE p.room_id=$1 AND p.active
		GROUP BY p.id, p.room_id, p.video_id, p.title, p.channel, p.suggested_by, p.active, p.created_at
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
	rows, err := p.pool.Query(ctx, `SELECT v.pick_id, v.user_id FROM youtube_room_pick_votes v JOIN youtube_room_picks p ON p.id = v.pick_id WHERE p.room_id=$1 AND p.active`, roomID)
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

func (p *Postgres) VoteRoomPick(ctx context.Context, pickID, userID string) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO youtube_room_pick_votes (pick_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, pickID, userID)
	return err
}
func (p *Postgres) PromoteRoomPick(ctx context.Context, pickID string) error {
	_, err := p.pool.Exec(ctx, `UPDATE youtube_room_picks SET active=FALSE WHERE id=$1 AND active`, pickID)
	return err
}
func (p *Postgres) SetAutoplay(ctx context.Context, settings YouTubeMediaSettings) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO youtube_room_media_settings (room_id, autoplay_enabled, updated_by) VALUES ($1,$2,$3) ON CONFLICT (room_id) DO UPDATE SET autoplay_enabled=EXCLUDED.autoplay_enabled, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, settings.RoomID, settings.AutoplayEnabled, settings.UpdatedBy)
	return err
}
func (p *Postgres) GetMediaSettings(ctx context.Context, roomID string) (YouTubeMediaSettings, error) {
	var s YouTubeMediaSettings
	err := p.pool.QueryRow(ctx, `SELECT room_id, autoplay_enabled, COALESCE(updated_by::text,''), updated_at FROM youtube_room_media_settings WHERE room_id=$1`, roomID).Scan(&s.RoomID, &s.AutoplayEnabled, &s.UpdatedBy, &s.UpdatedAt)
	return s, err
}

func Open(ctx context.Context, databaseURL string) (*Postgres, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	config.MaxConns = 10
	config.MinConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

func (p *Postgres) Close()                         { p.pool.Close() }
func (p *Postgres) Ping(ctx context.Context) error { return p.pool.Ping(ctx) }

func (p *Postgres) UpsertProfile(ctx context.Context, identity domain.Identity) error {
	_, err := p.pool.Exec(ctx, `INSERT INTO profiles (id, display_name, avatar_url)
		VALUES ($1, $2, NULLIF($3, '')) ON CONFLICT (id) DO UPDATE
		SET display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
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
	err := p.pool.QueryRow(ctx, `SELECT id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(password_verifier, ''), COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at
		FROM rooms WHERE id::text = $1 OR short_code = $1 OR invite_code = $1`, identifier).Scan(
		&room.ID, &room.Slug, &room.Name, &room.OwnerID, &room.AllowGuests, &room.MaxParticipants, &room.IsLocked, &room.Version, &room.PasswordRequired, &room.PasswordVerifier, &room.Atmosphere, &room.Accent, &room.AdaptiveMediaBackground, &room.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Room{}, domain.ErrNotFound
	}
	return domain.NormalizeRoomAppearance(room), err
}

func (p *Postgres) ListOwnedRooms(ctx context.Context, userID string) ([]domain.Room, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, COALESCE(short_code, invite_code), name, owner_id, allow_guests, max_participants, is_locked, version, password_required, COALESCE(atmosphere, 'ambient'), COALESCE(accent, 'blue'), COALESCE(adaptive_media_background, true), created_at
		FROM rooms WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 50`, userID)
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
	var message domain.Message
	err := p.pool.QueryRow(ctx, `INSERT INTO messages
		(room_id, sender_user_id, sender_guest_id, sender_type, sender_display_name, sender_avatar_url, content)
		VALUES ($1, CASE WHEN $2 = 'user' THEN $3::uuid END, CASE WHEN $2 = 'guest' THEN $3::uuid END, $2::identity_type, $4, NULLIF($5, ''), $6)
		RETURNING id, room_id, COALESCE(sender_user_id, sender_guest_id), sender_type, sender_display_name, COALESCE(sender_avatar_url, ''), content, created_at`,
		roomID, identity.Type, identity.ID, identity.DisplayName, identity.AvatarURL, content).Scan(
		&message.ID, &message.RoomID, &message.SenderID, &message.SenderType, &message.SenderDisplayName, &message.SenderAvatarURL, &message.Content, &message.CreatedAt)
	return message, err
}

func (p *Postgres) RecentMessages(ctx context.Context, roomID string, limit int) ([]domain.Message, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `SELECT id, room_id, COALESCE(sender_user_id, sender_guest_id), sender_type,
		sender_display_name, COALESCE(sender_avatar_url, ''), content, created_at FROM
		(SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2) recent
		ORDER BY created_at ASC, id ASC`, roomID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]domain.Message, 0, limit)
	for rows.Next() {
		var message domain.Message
		if err := rows.Scan(&message.ID, &message.RoomID, &message.SenderID, &message.SenderType, &message.SenderDisplayName, &message.SenderAvatarURL, &message.Content, &message.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	return messages, rows.Err()
}
