CREATE INDEX messages_sender_created_idx ON messages (sender_user_id, created_at DESC)
    WHERE sender_user_id IS NOT NULL;
