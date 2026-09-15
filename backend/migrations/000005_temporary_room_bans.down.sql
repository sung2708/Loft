DROP INDEX IF EXISTS room_bans_active_idx;
ALTER TABLE room_bans DROP COLUMN IF EXISTS expires_at;
