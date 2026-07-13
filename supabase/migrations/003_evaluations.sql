-- ============================================================
-- 003_evaluations.sql
-- Evaluations module: picklists, properties, evaluations,
-- contacts join, pipeline steps, lightstone reports,
-- property inspections.
-- ============================================================

-- ── 1. picklist_options ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS picklist_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_name     TEXT NOT NULL,
  value         TEXT NOT NULL,
  label         TEXT NOT NULL,
  allow_free_text BOOLEAN DEFAULT false,
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  UNIQUE (list_name, value)
);

-- Seed: lead_source
INSERT INTO picklist_options (list_name, value, label, allow_free_text, sort_order) VALUES
  ('lead_source', 'cold_calling',      'Cold Calling',      false, 1),
  ('lead_source', 'current_client',    'Current Client',    false, 2),
  ('lead_source', 'facebook',          'Facebook',          false, 3),
  ('lead_source', 'flyer',             'Flyer',             false, 4),
  ('lead_source', 'for_sale_board',    'For Sale Board',    false, 5),
  ('lead_source', 'instagram',         'Instagram',         false, 6),
  ('lead_source', 'office_phone_in',   'Office Phone-In',   false, 7),
  ('lead_source', 'referral',          'Referral',          false, 8),
  ('lead_source', 'website',           'Website',           false, 9),
  ('lead_source', 'other',             'Other',             true,  10)
ON CONFLICT (list_name, value) DO NOTHING;

-- Seed: motivation_for_selling
INSERT INTO picklist_options (list_name, value, label, allow_free_text, sort_order) VALUES
  ('motivation_for_selling', 'upsizing',   'Upsizing',   false, 1),
  ('motivation_for_selling', 'downsizing', 'Downsizing', false, 2),
  ('motivation_for_selling', 'other',      'Other',      true,  3)
ON CONFLICT (list_name, value) DO NOTHING;

-- Seed: selling_timeline
INSERT INTO picklist_options (list_name, value, label, sort_order) VALUES
  ('selling_timeline', 'now',                'Now',          1),
  ('selling_timeline', 'within_3_6_months',  '3–6 Months',   2),
  ('selling_timeline', 'within_6_12_months', '6–12 Months',  3),
  ('selling_timeline', '12_months_plus',     '12 Months+',   4),
  ('selling_timeline', 'unknown',            'Unknown',      5)
ON CONFLICT (list_name, value) DO NOTHING;

-- Seed: garden_description
INSERT INTO picklist_options (list_name, value, label, sort_order) VALUES
  ('garden_description', 'level',         'Level',          1),
  ('garden_description', 'slope_terrace', 'Slope / Terrace',2),
  ('garden_description', 'large',         'Large',          3),
  ('garden_description', 'medium',        'Medium',         4),
  ('garden_description', 'small',         'Small',          5)
ON CONFLICT (list_name, value) DO NOTHING;

-- Seed: patio_description
INSERT INTO picklist_options (list_name, value, label, sort_order) VALUES
  ('patio_description', 'covered',        'Covered',        1),
  ('patio_description', 'open',           'Open',           2),
  ('patio_description', 'sundeck',        'Sundeck',        3),
  ('patio_description', 'fully_enclosed', 'Fully Enclosed', 4)
ON CONFLICT (list_name, value) DO NOTHING;

-- Seed: contact_tag
INSERT INTO picklist_options (list_name, value, label, sort_order) VALUES
  ('contact_tag', 'seller',          'Seller',          1),
  ('contact_tag', 'attorney',        'Attorney',        2),
  ('contact_tag', 'managing_agent',  'Managing Agent',  3),
  ('contact_tag', 'tenant',          'Tenant',          4)
ON CONFLICT (list_name, value) DO NOTHING;

-- ── 2. properties ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number            TEXT,
  complex_or_building_name TEXT,
  street_number          TEXT,
  street_name            TEXT,
  suburb                 TEXT,
  city                   TEXT,
  province               TEXT,
  postal_code            TEXT,
  country                TEXT DEFAULT 'South Africa',
  google_place_id        TEXT,
  latitude               NUMERIC,
  longitude              NUMERIC,
  google_maps_url        TEXT,
  property_type          TEXT CHECK (property_type IN ('freehold','sectional_title','vacant_land')),
  created_by_user_id     UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS properties_place_id_idx
  ON properties (google_place_id) WHERE google_place_id IS NOT NULL;

-- ── 3. property_contacts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type TEXT CHECK (relationship_type IN ('current_owner','co_owner','previous_owner','tenant','managing_agent','other')),
  is_current        BOOLEAN DEFAULT true,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 4. evaluations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluations (
  id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Section 1: Evaluation Details
  property_id                       UUID NOT NULL REFERENCES properties(id),
  date_captured                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_by_user_id               UUID NOT NULL REFERENCES auth.users(id),
  status                            TEXT NOT NULL DEFAULT 'in_progress'
                                      CHECK (status IN ('in_progress','lost','open','future','won')),

  -- Section 2: Deal-Specific Property Details
  property_status                   TEXT CHECK (property_status IN ('off_market','on_market','deceased_estate')),
  sellers_agent_user_id             UUID REFERENCES auth.users(id),
  transaction_coordinator_user_id   UUID REFERENCES auth.users(id),

  -- Section 4: Lead Information
  lead_generated_by                 TEXT CHECK (lead_generated_by IN ('shelley_residential','seller_agent_partner')),
  lead_source_option_id             UUID REFERENCES picklist_options(id),
  lead_source_other_text            TEXT,
  lead_referral_notes               TEXT,
  referral_type                     TEXT CHECK (referral_type IN ('agent_referral','past_client_referral')),
  referral_contact_id               UUID REFERENCES contacts(id),

  -- Motivation & Timeline
  motivation_for_selling_option_id  UUID REFERENCES picklist_options(id),
  motivation_for_selling_notes      TEXT,
  selling_timeline_option_id        UUID REFERENCES picklist_options(id),
  selling_timeline_notes            TEXT,

  -- Section 5: Calendar
  scheduled_at                      TIMESTAMPTZ,
  calendar_event_id                 TEXT,
  calendar_event_link               TEXT,
  calendar_last_synced_at           TIMESTAMPTZ,

  created_at                        TIMESTAMPTZ DEFAULT now(),
  updated_at                        TIMESTAMPTZ DEFAULT now()
);

-- ── 5. evaluation_contacts ───────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id   UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  tag_option_id   UUID REFERENCES picklist_options(id),
  is_primary      BOOLEAN DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_primary_contact_per_eval
  ON evaluation_contacts (evaluation_id) WHERE is_primary = true;

-- ── 6. evaluation_pipeline_steps ────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_pipeline_steps (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id         UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  step_key              TEXT NOT NULL CHECK (step_key IN (
                          'captured','scheduled','lightstone_uploaded',
                          'property_inspected','description_captured')),
  is_complete           BOOLEAN DEFAULT false,
  completed_at          TIMESTAMPTZ,
  completed_by_user_id  UUID REFERENCES auth.users(id),
  assigned_user_id      UUID REFERENCES auth.users(id),
  sort_order            INT NOT NULL DEFAULT 0,
  UNIQUE (evaluation_id, step_key)
);

-- ── 7. lightstone_reports ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lightstone_reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID NOT NULL REFERENCES properties(id),
  evaluation_id         UUID NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  report_type           TEXT NOT NULL CHECK (report_type IN (
                          'property_report','suburb_report','ss_report','estate_report')),
  file_url              TEXT NOT NULL,
  file_name             TEXT,
  uploaded_by_user_id   UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (evaluation_id, report_type)
);

-- ── 8. property_inspections ──────────────────────────────────
CREATE TABLE IF NOT EXISTS property_inspections (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id                   UUID NOT NULL UNIQUE REFERENCES evaluations(id) ON DELETE CASCADE,
  captured_by_user_id             UUID NOT NULL REFERENCES auth.users(id),

  land_size                       TEXT CHECK (land_size IN ('subdivisible','not_subdivisible')),
  gate_type                       TEXT CHECK (gate_type IN ('auto_gate','manual','none')),
  fencing_type                    TEXT CHECK (fencing_type IN ('fully_fenced','walls','partial','none')),

  garages_quantity                INT DEFAULT 0,
  garages_descriptor              TEXT CHECK (garages_descriptor IN ('auto','tandem')),
  carports_quantity               INT DEFAULT 0,

  garden_present                  BOOLEAN,
  garden_notes                    TEXT,
  pool_present                    BOOLEAN,
  pool_condition                  TEXT CHECK (pool_condition IN ('good','poor')),
  jacuzzi_present                 BOOLEAN,
  jacuzzi_status                  TEXT CHECK (jacuzzi_status IN ('working','needs_repair')),
  tennis_court_present            BOOLEAN,

  patio_quantity                  INT DEFAULT 0,
  patio_notes                     TEXT,
  views_present                   BOOLEAN,
  domestic_quarters_quantity      INT DEFAULT 0,
  domestic_quarters_toilet_only   BOOLEAN DEFAULT false,
  flatlet_quantity                INT DEFAULT 0,
  flatlet_bedroom_type            TEXT CHECK (flatlet_bedroom_type IN ('one_bed','two_bed','three_bed')),
  flatlet_notes                   TEXT,

  lounges_quantity                INT DEFAULT 0,
  dining_room_quantity            INT DEFAULT 0,
  other_reception_quantity        INT DEFAULT 0,
  kitchen_quantity                INT DEFAULT 0,

  created_at                      TIMESTAMPTZ DEFAULT now(),
  updated_at                      TIMESTAMPTZ DEFAULT now()
);

-- ── 9. inspection_feature_selections ────────────────────────
CREATE TABLE IF NOT EXISTS inspection_feature_selections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_inspection_id  UUID NOT NULL REFERENCES property_inspections(id) ON DELETE CASCADE,
  feature_key             TEXT NOT NULL CHECK (feature_key IN ('garden_description','patio_description')),
  picklist_option_id      UUID NOT NULL REFERENCES picklist_options(id),
  UNIQUE (property_inspection_id, feature_key, picklist_option_id)
);

-- ── 10. updated_at triggers ──────────────────────────────────
CREATE OR REPLACE TRIGGER handle_updated_at_properties
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

CREATE OR REPLACE TRIGGER handle_updated_at_evaluations
  BEFORE UPDATE ON evaluations
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

CREATE OR REPLACE TRIGGER handle_updated_at_property_inspections
  BEFORE UPDATE ON property_inspections
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- ── 11. Row Level Security ───────────────────────────────────
ALTER TABLE picklist_options          ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties                ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_contacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_pipeline_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE lightstone_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_feature_selections ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read/write all evaluations data (no role restriction yet)
CREATE POLICY "Auth users read picklists"   ON picklist_options          FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all properties"   ON properties                FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all prop_contacts" ON property_contacts        FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all evaluations"  ON evaluations               FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all eval_contacts" ON evaluation_contacts      FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all pipeline"     ON evaluation_pipeline_steps FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all lightstone"   ON lightstone_reports        FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all inspections"  ON property_inspections      FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Auth users all feat_sel"     ON inspection_feature_selections FOR ALL USING (auth.role() = 'authenticated');
