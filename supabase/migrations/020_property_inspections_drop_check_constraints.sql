-- The Inspection tab stores several answers in one column (e.g. two
-- flatlets -> "studio,one_bed") and offers option values the old database
-- rules never allowed (e.g. Jacuzzi "good"/"poor"; flatlet "studio"). Those
-- column-by-column CHECK rules reject valid answers and block the save.
-- The app already controls which options exist, so every CHECK constraint on
-- property_inspections is looked up and dropped by name from the catalog
-- (the live names don't match any committed migration).
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'property_inspections'
      AND c.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.property_inspections DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
