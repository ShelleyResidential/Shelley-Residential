-- Split the name column into first_name and last_name

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Migrate existing records: put the full name into first_name
UPDATE contacts SET first_name = name WHERE first_name IS NULL OR first_name = '';
UPDATE contacts SET last_name  = ''   WHERE last_name  IS NULL;

-- Make both NOT NULL going forward
ALTER TABLE contacts ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE contacts ALTER COLUMN last_name  SET NOT NULL;

-- Update the search index to cover both columns
CREATE INDEX IF NOT EXISTS contacts_first_name_idx ON contacts (first_name);
CREATE INDEX IF NOT EXISTS contacts_last_name_idx  ON contacts (last_name);
