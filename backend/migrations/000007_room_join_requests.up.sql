CREATE TABLE room_join_requests (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE INDEX room_join_requests_room_created_idx ON room_join_requests (room_id, requested_at);

ALTER TABLE room_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON room_join_requests FROM anon, authenticated;
