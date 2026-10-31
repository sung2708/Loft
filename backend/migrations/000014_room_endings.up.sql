CREATE TABLE room_endings (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE room_endings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON room_endings FROM anon, authenticated;
