ALTER TABLE rooms
    DROP CONSTRAINT IF EXISTS rooms_accent_valid,
    DROP CONSTRAINT IF EXISTS rooms_atmosphere_valid,
    DROP COLUMN IF EXISTS adaptive_media_background,
    DROP COLUMN IF EXISTS accent,
    DROP COLUMN IF EXISTS atmosphere;
