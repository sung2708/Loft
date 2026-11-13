DROP TRIGGER IF EXISTS admin_audit_log_no_update ON admin_audit_log;
DROP FUNCTION IF EXISTS admin_audit_log_append_only();
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS account_bans;
