-- 012_evaluation_status_expand.sql
-- Expand the Evaluation Status list. New evaluations use the new set
-- (new/scheduled/completed/presented/follow_up/won/lost/on_hold/cancelled),
-- default 'new'. Existing rows keep their old status value untouched
-- (in_progress/open/future are left as-is, not remapped) — the CHECK
-- constraint allows both old and new values so nothing breaks.

ALTER TABLE evaluations
  ALTER COLUMN status SET DEFAULT 'new';

ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_status_check;

ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_status_check CHECK (status IN (
    'in_progress', 'open', 'future',
    'new', 'scheduled', 'completed', 'presented', 'follow_up',
    'won', 'lost', 'on_hold', 'cancelled'
  ));
