-- Upgrade for a database created with an earlier setup.sql. Safe to run more than once.
SET search_path TO elite_diary;

-- Photos and PDFs shared in Communication.
CREATE TABLE IF NOT EXISTS chat_media(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),uploader_id TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,name TEXT NOT NULL,size INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_media_conversation ON chat_media(conversation_id,created_at);
ALTER TABLE elite_diary.chat_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON elite_diary.chat_media FROM PUBLIC,anon,authenticated;

-- Encrypted copy of an administrator-issued temporary password (visible to Super Admin until changed).
ALTER TABLE account_security ADD COLUMN IF NOT EXISTS password_enc TEXT;

RESET search_path;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='elite_diary_app') THEN
GRANT SELECT,INSERT ON elite_diary.chat_media TO elite_diary_app;
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='elite_diary' AND tablename='chat_media' AND policyname='server_application') THEN CREATE POLICY server_application ON elite_diary.chat_media FOR ALL TO elite_diary_app USING(true) WITH CHECK(true); END IF;
END IF; END $$;
