CREATE TABLE room_whiteboards (
 room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
 version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
 records JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(records) = 'object' AND octet_length(records::text) <= 2200000),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE room_whiteboards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON room_whiteboards FROM anon, authenticated;
