ALTER TABLE youtube_room_picks
    ALTER COLUMN suggested_by DROP NOT NULL,
    ADD COLUMN suggested_by_guest UUID,
    ADD CONSTRAINT youtube_pick_actor CHECK ((suggested_by IS NULL) <> (suggested_by_guest IS NULL));

ALTER TABLE youtube_room_pick_votes
    DROP CONSTRAINT youtube_room_pick_votes_pkey,
    ALTER COLUMN user_id DROP NOT NULL,
    ADD COLUMN guest_id UUID,
    ADD CONSTRAINT youtube_vote_actor CHECK ((user_id IS NULL) <> (guest_id IS NULL));
CREATE UNIQUE INDEX youtube_vote_user ON youtube_room_pick_votes(pick_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX youtube_vote_guest ON youtube_room_pick_votes(pick_id,guest_id) WHERE guest_id IS NOT NULL;
