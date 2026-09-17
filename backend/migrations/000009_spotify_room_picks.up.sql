CREATE TABLE spotify_room_picks (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    spotify_track_reference TEXT NOT NULL,
    track_name TEXT NOT NULL,
    artist_names TEXT[] NOT NULL DEFAULT '{}',
    album_image_url TEXT,
    suggested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX spotify_room_picks_active_track_idx ON spotify_room_picks(room_id, spotify_track_reference) WHERE active;
CREATE TABLE spotify_room_pick_votes (
    pick_id UUID NOT NULL REFERENCES spotify_room_picks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pick_id, user_id)
);
ALTER TABLE spotify_room_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE spotify_room_pick_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spotify_room_picks, spotify_room_pick_votes FROM anon, authenticated;
