CREATE TABLE youtube_room_media_settings (
    room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    autoplay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE youtube_room_media_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON youtube_room_media_settings FROM anon, authenticated;
