-- 006_google_calendar.sql
-- Google Calendar OAuth token storage + track event IDs on evaluations

CREATE TABLE user_google_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own google tokens"
  ON user_google_tokens FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON user_google_tokens
  FOR EACH ROW EXECUTE PROCEDURE moddatetime(updated_at);

-- Track which Google Calendar event is linked to each evaluation (for updates/deletes)
ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
