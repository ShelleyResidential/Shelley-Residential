-- 010_evaluation_reason_lost.sql
-- Reason Lost is a hardcoded dropdown (like lead source / motivation / timeline)
-- whose resolved label is stored as free text, only relevant when status = 'lost'.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS reason_lost TEXT;
