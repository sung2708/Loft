ALTER TABLE rooms
    ADD COLUMN atmosphere TEXT NOT NULL DEFAULT 'ambient',
    ADD COLUMN accent TEXT NOT NULL DEFAULT 'blue',
    ADD COLUMN adaptive_media_background BOOLEAN NOT NULL DEFAULT TRUE,
    ADD CONSTRAINT rooms_atmosphere_valid CHECK (atmosphere IN ('minimal', 'ambient', 'focus', 'party')),
    ADD CONSTRAINT rooms_accent_valid CHECK (accent IN ('blue', 'purple', 'green', 'orange', 'rose'));
