-- Replies, edits and soft deletes. Original text is kept in message_revisions
-- so moderation can review what was changed or removed.
ALTER TABLE messages
    ADD COLUMN reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    ADD COLUMN edited_at TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE TABLE message_revisions (
    id BIGSERIAL PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('edit', 'delete')),
    previous_content VARCHAR(2000) NOT NULL,
    actor_type identity_type NOT NULL,
    actor_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX message_revisions_message_idx ON message_revisions (message_id, created_at DESC);

ALTER TABLE message_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON message_revisions FROM anon, authenticated;
