DROP INDEX IF EXISTS admin_audit_log_actor_idx;
DROP TABLE IF EXISTS content_reports;
DROP TABLE IF EXISTS room_visits;
DROP TABLE IF EXISTS account_deletions;

-- Bans whose author account was deleted keep applying; the room owner becomes
-- their author so NOT NULL can be restored.
UPDATE room_bans b SET banned_by = r.owner_id FROM rooms r WHERE b.room_id = r.id AND b.banned_by IS NULL;
ALTER TABLE room_bans DROP CONSTRAINT room_bans_banned_by_fkey;
ALTER TABLE room_bans ADD CONSTRAINT room_bans_banned_by_fkey
    FOREIGN KEY (banned_by) REFERENCES profiles(id);
ALTER TABLE room_bans ALTER COLUMN banned_by SET NOT NULL;

ALTER TABLE profiles DROP COLUMN IF EXISTS hide_avatar;
ALTER TABLE profiles DROP COLUMN IF EXISTS custom_display_name;
