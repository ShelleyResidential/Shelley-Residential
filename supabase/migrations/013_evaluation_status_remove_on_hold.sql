-- 013_evaluation_status_remove_on_hold.sql
-- Drop "On Hold" from the Evaluation Status list -- it's no longer offered
-- anywhere in the UI. Any existing rows using it are moved to 'new' so the
-- CHECK constraint can be tightened without leaving orphaned data.

UPDATE evaluations SET status = 'new' WHERE status = 'on_hold';

ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_status_check;

ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_status_check CHECK (status IN (
    'in_progress', 'open', 'future',
    'new', 'scheduled', 'completed', 'presented', 'follow_up',
    'won', 'lost', 'cancelled'
  ));
