-- 007_evaluation_table_fields.sql
-- 1. Add Evaluation Price / Marketing Price to evaluations
-- 2. Add a public profiles table (mirrors auth.users) so agent/TC names
--    can be displayed and picked from a dropdown, since auth.users isn't
--    directly queryable via the client.

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS evaluation_price NUMERIC,
  ADD COLUMN IF NOT EXISTS marketing_price  NUMERIC;

CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  email      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read all profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Keep profiles in sync with auth.users on sign-up / metadata update
CREATE OR REPLACE FUNCTION public.handle_new_or_updated_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    email      = EXCLUDED.email,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_or_updated ON auth.users;
CREATE TRIGGER on_auth_user_created_or_updated
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_or_updated_user();

-- Backfill existing users
INSERT INTO public.profiles (id, full_name, email)
SELECT id, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'), email
FROM auth.users
ON CONFLICT (id) DO NOTHING;
