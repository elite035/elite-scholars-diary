-- Additive account security and immutable future branding. Existing users/diaries are unchanged.

SET search_path=elite_diary,public;
CREATE TABLE IF NOT EXISTS account_security(user_id TEXT PRIMARY KEY REFERENCES users(id),must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN(0,1)),totp_secret TEXT,pending_secret TEXT,pending_until TEXT,last_counter BIGINT NOT NULL DEFAULT -1,recovery_hashes TEXT NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(recovery_hashes::jsonb)='array'),attempts INTEGER NOT NULL DEFAULT 0,window_start BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS branding_assets(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL);
DROP TRIGGER IF EXISTS immutable_history ON branding_assets;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON branding_assets FOR EACH ROW EXECUTE FUNCTION elite_diary.prevent_history_mutation();
ALTER TABLE account_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE branding_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security,branding_assets FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS audit_action_time ON audit(action,created_at);
CREATE INDEX IF NOT EXISTS audit_created_time ON audit(created_at,id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='elite_diary_app') THEN
 GRANT SELECT,INSERT,UPDATE,DELETE ON elite_diary.account_security TO elite_diary_app;
 GRANT SELECT,INSERT ON elite_diary.branding_assets TO elite_diary_app;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='elite_diary' AND tablename='account_security' AND policyname='server_application') THEN CREATE POLICY server_application ON elite_diary.account_security FOR ALL TO elite_diary_app USING(true) WITH CHECK(true); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='elite_diary' AND tablename='branding_assets' AND policyname='server_application') THEN CREATE POLICY server_application ON elite_diary.branding_assets FOR ALL TO elite_diary_app USING(true) WITH CHECK(true); END IF;
END IF; END $$;
INSERT INTO migrations VALUES(5,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
RESET search_path;
