CREATE TABLE room_moderation (
 room_id UUID PRIMARY KEY,
 actor_id UUID NOT NULL,
 reason TEXT NOT NULL CHECK (reason IN ('illegal','policy','safety','spam','other')),
 note TEXT NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Preserve decisions even if a room or an account is subsequently deleted.
ALTER TABLE room_moderation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON room_moderation FROM anon, authenticated;
