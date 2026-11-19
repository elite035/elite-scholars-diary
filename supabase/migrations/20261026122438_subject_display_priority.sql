SET search_path=elite_diary,public;
CREATE TABLE IF NOT EXISTS subject_priorities(subject_id TEXT PRIMARY KEY REFERENCES academics(id) ON DELETE CASCADE,priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 1000000));
ALTER TABLE elite_diary.subject_priorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON elite_diary.subject_priorities FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='elite_diary_app') THEN
GRANT SELECT,INSERT,UPDATE,DELETE ON elite_diary.subject_priorities TO elite_diary_app;
IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='elite_diary' AND tablename='subject_priorities' AND policyname='server_application') THEN CREATE POLICY server_application ON elite_diary.subject_priorities FOR ALL TO elite_diary_app USING(true) WITH CHECK(true); END IF;
END IF; END $$;
