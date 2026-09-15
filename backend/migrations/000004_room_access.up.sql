ALTER TABLE rooms
    ADD COLUMN password_verifier TEXT,
    ADD COLUMN password_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rooms
    ADD CONSTRAINT rooms_password_policy_consistent
    CHECK ((password_required AND password_verifier IS NOT NULL)
        OR (NOT password_required));
