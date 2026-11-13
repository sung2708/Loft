-- Post-call ratings plus coarse client-side quality samples. No raw WebRTC
-- stats, IPs or device identifiers are stored.
CREATE TABLE call_feedback (
    id BIGSERIAL PRIMARY KEY,
    room_id UUID NOT NULL,
    identity_type identity_type NOT NULL,
    identity_id UUID NOT NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    tags TEXT[] NOT NULL DEFAULT '{}' CHECK (tags <@ ARRAY['echo','choppy_audio','frozen_video','lag','disconnects','other']::TEXT[]),
    duration_seconds INT NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
    samples_good INT NOT NULL CHECK (samples_good BETWEEN 0 AND 20000),
    samples_poor INT NOT NULL CHECK (samples_poor BETWEEN 0 AND 20000),
    samples_lost INT NOT NULL CHECK (samples_lost BETWEEN 0 AND 20000),
    reconnects INT NOT NULL CHECK (reconnects BETWEEN 0 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX call_feedback_created_idx ON call_feedback (created_at DESC);

ALTER TABLE call_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON call_feedback FROM anon, authenticated;
