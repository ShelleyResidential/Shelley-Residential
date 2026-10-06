-- 018_evaluation_documents_report_type.sql
-- evaluation_documents was created directly in Supabase (schema drift --
-- never committed as a migration), so its report_type CHECK constraint's
-- exact name is unknown here. Look it up by column instead of guessing a
-- name, drop it, then add the full known+new value list back. ADD
-- CONSTRAINT validates every existing row automatically -- if any row
-- currently holds a report_type value outside this list, this statement
-- fails loudly and nothing is changed, rather than silently corrupting data.

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel    ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'evaluation_documents'
    AND con.contype  = 'c'
    AND att.attname  = 'report_type';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evaluation_documents DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE evaluation_documents
  ADD CONSTRAINT evaluation_documents_report_type_check
  CHECK (report_type IN ('property_report', 'suburb_report', 'ss_report', 'cover_letter', 'inspection_form'));
