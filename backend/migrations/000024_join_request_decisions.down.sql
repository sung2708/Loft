DELETE FROM room_join_requests WHERE status <> 'pending';
ALTER TABLE room_join_requests DROP COLUMN status;
