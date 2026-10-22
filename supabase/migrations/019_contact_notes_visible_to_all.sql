-- Contact notes become visible to every signed-in agent. Writing, editing
-- and deleting stay limited to the note's author (those policies are
-- untouched). Every existing SELECT policy on the two tables is looked up
-- and dropped by command rather than by guessed name, so this works
-- whatever the live policies are called.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('contact_notes', 'contact_note_history')
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

CREATE POLICY "All agents can read contact notes"
  ON public.contact_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All agents can read contact note history"
  ON public.contact_note_history FOR SELECT
  TO authenticated
  USING (true);
