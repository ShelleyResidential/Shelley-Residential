-- 016_guest_loo.sql
-- Add Guest Loo to property_inspections -- same shape as Bathrooms
-- (a quantity counter + one condition per unit).

ALTER TABLE property_inspections
  ADD COLUMN IF NOT EXISTS guest_loo_quantity    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guest_loo_conditions  TEXT;  -- comma-separated: modern,needs_work,outdated,...
