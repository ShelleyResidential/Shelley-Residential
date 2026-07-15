-- 008_referral_type_open.sql
-- The Referral Type dropdown now has 12 options instead of 2, and stores
-- the resolved label as free text (matching how motivation/timeline/lead
-- source are already stored), so the old restrictive CHECK no longer fits.

ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_referral_type_check;
