BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_level SMALLINT;
UPDATE users SET support_level = 1 WHERE role = 'Técnico' AND support_level IS NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_support_level_check;
ALTER TABLE users ADD CONSTRAINT users_support_level_check CHECK (
  (role = 'Técnico' AND support_level BETWEEN 1 AND 3)
  OR (role <> 'Técnico' AND support_level IS NULL)
);
-- Accounts imported by old seed have no password. A real admin must activate/create accounts.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS requester_email VARCHAR(254);
CREATE INDEX IF NOT EXISTS idx_tickets_requester_email ON tickets(requester_email);
COMMIT;
