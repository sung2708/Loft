ALTER TABLE account_deletions ADD COLUMN retry_after TIMESTAMPTZ;
DROP INDEX account_deletions_due_idx;
CREATE INDEX account_deletions_due_idx ON account_deletions (GREATEST(scheduled_for, retry_after), user_id);
