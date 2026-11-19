-- Additive guards; abort on unresolved conflicts rather than rewrite historical rows.
SET search_path=elite_diary,public;
CREATE UNIQUE INDEX IF NOT EXISTS active_assignment_business_key ON assignments(teacher_id,section_id,subject_id,session_id) WHERE active=1;
CREATE UNIQUE INDEX IF NOT EXISTS active_subject_name_key ON academics(LOWER(TRIM(name))) WHERE active=1 AND kind='subject';
CREATE UNIQUE INDEX IF NOT EXISTS active_section_name_key ON academics(parent_id,LOWER(TRIM(name))) WHERE active=1 AND kind='section';
CREATE OR REPLACE FUNCTION elite_diary.validate_campus_class_name() RETURNS trigger LANGUAGE plpgsql SET search_path=elite_diary,pg_temp AS $$
DECLARE target_campus text; target_class text; target_name text;
BEGIN
 IF TG_TABLE_NAME='class_campuses' THEN target_campus=NEW.campus_id;target_class=NEW.class_id;SELECT LOWER(TRIM(name)) INTO target_name FROM academics WHERE id=target_class AND active=1;
 ELSE IF NEW.kind<>'class' OR NEW.active<>1 THEN RETURN NEW;END IF;target_class=NEW.id;target_name=LOWER(TRIM(NEW.name));SELECT campus_id INTO target_campus FROM class_campuses WHERE class_id=target_class;END IF;
 IF target_campus IS NOT NULL AND target_name IS NOT NULL AND EXISTS(SELECT 1 FROM class_campuses cc JOIN academics a ON a.id=cc.class_id WHERE cc.campus_id=target_campus AND cc.class_id<>target_class AND a.active=1 AND LOWER(TRIM(a.name))=target_name) THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='This class and section are already assigned to this campus.';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campus_class_name_guard ON class_campuses;
CREATE TRIGGER campus_class_name_guard BEFORE INSERT OR UPDATE ON class_campuses FOR EACH ROW EXECUTE FUNCTION elite_diary.validate_campus_class_name();
DROP TRIGGER IF EXISTS academic_class_name_guard ON academics;
CREATE TRIGGER academic_class_name_guard BEFORE UPDATE ON academics FOR EACH ROW EXECUTE FUNCTION elite_diary.validate_campus_class_name();
REVOKE ALL ON FUNCTION elite_diary.validate_campus_class_name() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='school_diary_json_shapes' AND conrelid='elite_diary.school_diaries'::regclass) THEN ALTER TABLE school_diaries ADD CONSTRAINT school_diary_json_shapes CHECK(jsonb_typeof(content::jsonb)='object' AND jsonb_typeof(snapshot::jsonb)='object' AND jsonb_typeof(quote_payload::jsonb)='array') NOT VALID;END IF;
END $$;
INSERT INTO migrations VALUES(6,to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
RESET search_path;
