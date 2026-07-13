-- 004_inspection_updates.sql
-- 1. Add scullery/laundry fields to property_inspections
-- 2. Fix pipeline step sort_order so inspection comes before lightstone

ALTER TABLE property_inspections
  ADD COLUMN IF NOT EXISTS scullery_laundry_present BOOLEAN,
  ADD COLUMN IF NOT EXISTS scullery_laundry_type TEXT CHECK (scullery_laundry_type IN ('separated','adjoined'));

-- Reorder pipeline steps for all existing evaluations
UPDATE evaluation_pipeline_steps SET sort_order = 2 WHERE step_key = 'property_inspected';
UPDATE evaluation_pipeline_steps SET sort_order = 3 WHERE step_key = 'description_captured';
UPDATE evaluation_pipeline_steps SET sort_order = 4 WHERE step_key = 'lightstone_uploaded';
