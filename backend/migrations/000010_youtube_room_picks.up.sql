CREATE TABLE youtube_room_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    video_id TEXT NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
    title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 140),
    channel TEXT NOT NULL DEFAULT '' CHECK (char_length(channel) <= 80),
    suggested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX youtube_room_picks_active_video_idx ON youtube_room_picks(room_id, video_id) WHERE active;
CREATE TABLE youtube_room_pick_votes (
    pick_id UUID NOT NULL REFERENCES youtube_room_picks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pick_id, user_id)
);
ALTER TABLE youtube_room_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE youtube_room_pick_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON youtube_room_picks, youtube_room_pick_votes FROM anon, authenticated;
