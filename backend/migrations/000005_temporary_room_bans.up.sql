ALTER TABLE room_bans
    ADD COLUMN expires_at TIMESTAMPTZ;

CREATE INDEX room_bans_active_idx
    ON room_bans (room_id, identity_type, identity_id, expires_at);
