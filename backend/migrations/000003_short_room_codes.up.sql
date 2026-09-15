-- Keep rooms.id as the durable UUID while exposing a six-digit public code.
-- The existing invite_code column remains as a legacy alias so old links keep
-- resolving after this migration.
ALTER TABLE rooms ADD COLUMN short_code VARCHAR(6);

CREATE OR REPLACE FUNCTION loft_generate_room_short_code() RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    random_bytes BYTEA;
    random_value BIGINT;
    candidate VARCHAR(6);
BEGIN
    LOOP
        random_bytes := gen_random_bytes(4);
        random_value := get_byte(random_bytes, 0)::BIGINT * 16777216
            + get_byte(random_bytes, 1)::BIGINT * 65536
            + get_byte(random_bytes, 2)::BIGINT * 256
            + get_byte(random_bytes, 3)::BIGINT;
        candidate := LPAD((random_value % 1000000)::TEXT, 6, '0');
        IF NOT EXISTS (SELECT 1 FROM rooms WHERE short_code = candidate) THEN
            RETURN candidate;
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    room_row RECORD;
BEGIN
    FOR room_row IN SELECT id FROM rooms WHERE short_code IS NULL LOOP
        UPDATE rooms SET short_code = loft_generate_room_short_code()
        WHERE id = room_row.id;
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX rooms_short_code_key ON rooms (short_code);
ALTER TABLE rooms ALTER COLUMN short_code SET DEFAULT loft_generate_room_short_code();
ALTER TABLE rooms ALTER COLUMN short_code SET NOT NULL;
ALTER TABLE rooms ADD CONSTRAINT rooms_short_code_format CHECK (short_code ~ '^[0-9]{6}$');
