-- 009_property_sectional_title_number.sql
-- Add Sectional Title Number field for sectional title properties.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS sectional_title_number TEXT;
