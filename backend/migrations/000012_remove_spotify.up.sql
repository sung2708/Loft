-- Spotify was removed from the application. Delete provider credentials and
-- room-pick data after the historical 000008/000009 migrations have run.
DROP TABLE IF EXISTS spotify_room_pick_votes;
DROP TABLE IF EXISTS spotify_room_picks;
DROP TABLE IF EXISTS spotify_connections;
