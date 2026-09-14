CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE identity_type AS ENUM ('user', 'guest');
CREATE TYPE room_role AS ENUM ('host', 'member');

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name VARCHAR(64) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_code VARCHAR(24) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(9), 'hex'),
    name VARCHAR(80) NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
    owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    allow_guests BOOLEAN NOT NULL DEFAULT TRUE,
    max_participants SMALLINT NOT NULL DEFAULT 12 CHECK (max_participants BETWEEN 2 AND 12),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_members (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role room_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    sender_guest_id UUID,
    sender_type identity_type NOT NULL,
    sender_display_name VARCHAR(64) NOT NULL,
    sender_avatar_url TEXT,
    content VARCHAR(2000) NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((sender_type = 'user' AND sender_guest_id IS NULL)
        OR (sender_type = 'guest' AND sender_user_id IS NULL AND sender_guest_id IS NOT NULL))
);

CREATE INDEX messages_room_created_idx ON messages (room_id, created_at DESC, id DESC);
CREATE INDEX rooms_owner_updated_idx ON rooms (owner_id, updated_at DESC);
CREATE INDEX room_members_user_idx ON room_members (user_id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON profiles, rooms, room_members, messages FROM anon, authenticated;
