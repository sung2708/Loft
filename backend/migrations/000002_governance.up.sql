ALTER TABLE rooms ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rooms ADD COLUMN version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0);

CREATE TABLE room_bans (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    identity_type identity_type NOT NULL,
    identity_id UUID NOT NULL,
    banned_by UUID NOT NULL REFERENCES profiles(id),
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, identity_type, identity_id)
);

ALTER TABLE room_bans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON room_bans FROM anon, authenticated;
