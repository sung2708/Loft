-- Irreversible: the removed Spotify tables contained credentials and user data.
-- Restoring this migration must be done from a database backup, not by recreating
-- empty tables that could be mistaken for the old schema.
SELECT 1;
