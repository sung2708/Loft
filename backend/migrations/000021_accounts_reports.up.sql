-- Account self-service, recent rooms, and user reports.

-- A member-chosen display name survives OAuth sign-ins, which overwrite
-- provider metadata; NULL falls back to the provider name.
ALTER TABLE profiles
    ADD COLUMN custom_display_name VARCHAR(64)
        CHECK (custom_display_name IS NULL OR char_length(custom_display_name) BETWEEN 2 AND 48),
    ADD COLUMN hide_avatar BOOLEAN NOT NULL DEFAULT FALSE;

-- A host's room bans outlive the host's account: the ban stays, the author clears.
ALTER TABLE room_bans ALTER COLUMN banned_by DROP NOT NULL;
ALTER TABLE room_bans DROP CONSTRAINT room_bans_banned_by_fkey;
ALTER TABLE room_bans ADD CONSTRAINT room_bans_banned_by_fkey
    FOREIGN KEY (banned_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Self-service deletion with a grace period. The row is the whole schedule:
-- cancelling deletes it, the sweeper purges the account once it is due.
CREATE TABLE account_deletions (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ NOT NULL
);
CREATE INDEX account_deletions_due_idx ON account_deletions (scheduled_for);

-- Rooms a signed-in member has entered, for the "Recent" list on /home.
-- hidden removes a room from that list without touching membership.
CREATE TABLE room_visits (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, room_id)
);
CREATE INDEX room_visits_user_recent_idx ON room_visits (user_id, last_visited_at DESC);

-- Reports about a participant or a room. No foreign keys: a report is a
-- safety record and outlives the room and both accounts.
CREATE TABLE content_reports (
    id BIGSERIAL PRIMARY KEY,
    reporter_type identity_type NOT NULL,
    reporter_id UUID NOT NULL,
    reporter_name VARCHAR(64) NOT NULL,
    room_id UUID NOT NULL,
    room_name VARCHAR(80) NOT NULL DEFAULT '',
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'guest', 'room')),
    target_id UUID NOT NULL,
    target_name VARCHAR(80) NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('illegal', 'policy', 'safety', 'spam', 'other')),
    details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 1000),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
    resolved_by UUID,
    resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status = 'open') = (resolved_at IS NULL))
);
-- One open report per reporter and target: repeats refresh nothing.
CREATE UNIQUE INDEX content_reports_open_once_idx
    ON content_reports (reporter_type, reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX content_reports_queue_idx ON content_reports (status, created_at, id);
CREATE INDEX content_reports_target_idx ON content_reports (target_type, target_id, created_at DESC);

CREATE INDEX admin_audit_log_actor_idx ON admin_audit_log (actor_id, created_at DESC);

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_deletions, room_visits, content_reports FROM anon, authenticated;
