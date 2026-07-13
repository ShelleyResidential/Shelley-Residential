-- 005_inspection_rooms.sql
-- Add bedroom, study, bathroom, security, general condition, and additional features fields

ALTER TABLE property_inspections
  ADD COLUMN IF NOT EXISTS bedrooms_quantity       INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bedroom_sizes           TEXT,  -- comma-separated: large,medium,small,...
  ADD COLUMN IF NOT EXISTS study_quantity          INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_types             TEXT,  -- comma-separated: nook,separate_room,...
  ADD COLUMN IF NOT EXISTS bathrooms_quantity      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bathroom_conditions     TEXT,  -- comma-separated: modern,needs_work,outdated,...
  ADD COLUMN IF NOT EXISTS security_present        BOOLEAN,
  ADD COLUMN IF NOT EXISTS security_features       TEXT,  -- comma-separated: standard,cctv,electric_fencing
  ADD COLUMN IF NOT EXISTS general_condition       TEXT,  -- JSON: [{"feature":"flooring","condition":"good"},...]
  ADD COLUMN IF NOT EXISTS additional_features     TEXT;  -- comma-separated: jungle_gym,jojo_tank,...
