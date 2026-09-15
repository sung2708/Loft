ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_short_code_format;
ALTER TABLE rooms DROP COLUMN IF EXISTS short_code;
DROP FUNCTION IF EXISTS loft_generate_room_short_code();
