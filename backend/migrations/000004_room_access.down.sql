ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_password_policy_consistent;
ALTER TABLE rooms DROP COLUMN IF EXISTS password_required;
ALTER TABLE rooms DROP COLUMN IF EXISTS password_verifier;
