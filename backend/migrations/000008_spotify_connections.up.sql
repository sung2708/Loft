CREATE TABLE spotify_connections (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    access_token_ciphertext TEXT NOT NULL,
    refresh_token_ciphertext TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE spotify_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spotify_connections FROM anon, authenticated;
