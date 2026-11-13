DROP INDEX account_deletions_due_idx;
ALTER TABLE account_deletions DROP COLUMN retry_after;
CREATE INDEX account_deletions_due_idx ON account_deletions (scheduled_for);
