-- 011_profile_role.sql
-- One-time "What is your role?" question shown after login. Null means
-- the user hasn't answered yet; Agent/TC pickers throughout the app
-- filter the profiles list by this value.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('agent', 'transaction_coordinator'));

-- profiles previously only had a read policy (it's normally kept in sync by
-- a trigger from auth.users); users now need to set their own role once.
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
