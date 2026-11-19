-- Add a constraint to the existing relationship table without changing any rows.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM elite_diary.coordinator_heads GROUP BY head_id HAVING COUNT(*)>1) THEN
  RAISE EXCEPTION 'A Head Teacher has multiple Coordinators. Resolve these existing conflicts explicitly before applying this migration. No relationships have been removed.';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS coordinator_head_single_parent ON elite_diary.coordinator_heads(head_id);
