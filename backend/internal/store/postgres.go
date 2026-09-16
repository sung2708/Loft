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
)

type Postgres struct{ pool *pgxpool.Pool }

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
