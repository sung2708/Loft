-- Refuse rollback while guest data exists rather than silently deleting votes.
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM youtube_room_picks WHERE suggested_by_guest IS NOT NULL)
        OR EXISTS(SELECT 1 FROM youtube_room_pick_votes WHERE guest_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Guest picks/votes exist; export and resolve them before rollback';
    END IF;
END $$;
DROP INDEX youtube_vote_guest;
DROP INDEX youtube_vote_user;
ALTER TABLE youtube_room_pick_votes DROP CONSTRAINT youtube_vote_actor, DROP COLUMN guest_id,
    ALTER COLUMN user_id SET NOT NULL, ADD PRIMARY KEY(pick_id,user_id);
ALTER TABLE youtube_room_picks DROP CONSTRAINT youtube_pick_actor, DROP COLUMN suggested_by_guest,
    ALTER COLUMN suggested_by SET NOT NULL;
