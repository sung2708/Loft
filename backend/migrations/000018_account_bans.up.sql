-- Account-level suspensions, enforced at every authenticated entry point
-- (REST, WebSocket admission, LiveKit token issuance).
CREATE TABLE account_bans (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('illegal', 'policy', 'safety', 'spam', 'other')),
    note TEXT NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only record of every admin decision.
CREATE TABLE admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT,
    note TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX admin_audit_log_created_idx ON admin_audit_log (created_at DESC, id DESC);
CREATE INDEX admin_audit_log_target_idx ON admin_audit_log (target_type, target_id, created_at DESC);

CREATE FUNCTION admin_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$;
CREATE TRIGGER admin_audit_log_no_update
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();

ALTER TABLE account_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_bans, admin_audit_log FROM anon, authenticated;
