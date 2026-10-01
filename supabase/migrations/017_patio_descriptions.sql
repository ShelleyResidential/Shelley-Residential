-- 017_patio_descriptions.sql
-- Entertainment Patio moves to a per-unit model (quantity + one set of
-- description tags per patio, like Bedrooms/Bathrooms) instead of one set
-- of tags shared across however many patios there are. The old
-- picklist-linked inspection_feature_selections approach had no concept of
-- "which patio" a selection belonged to, so patio descriptions move to
-- their own JSON column here -- same pattern as general_condition.
-- picklist_options/inspection_feature_selections rows for patio_description
-- are left in place (harmless, just no longer read by the app).

ALTER TABLE property_inspections
  ADD COLUMN IF NOT EXISTS patio_descriptions  TEXT;  -- JSON: [["Covered","Large"],["Open / Sundeck"],...] -- one array per patio unit
