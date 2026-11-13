DROP TABLE IF EXISTS message_revisions;
ALTER TABLE messages
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS edited_at,
    DROP COLUMN IF EXISTS reply_to_id;
