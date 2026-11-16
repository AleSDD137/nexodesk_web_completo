BEGIN;
CREATE TABLE IF NOT EXISTS intelligence_runs (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(16) NOT NULL CHECK(provider IN ('local','openai')),
  model VARCHAR(100),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
  outcome VARCHAR(16) NOT NULL DEFAULT 'running' CHECK(outcome IN ('running','complete','fallback')),
  error_code VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_intelligence_runs_budget ON intelligence_runs(created_at,requested_by);
CREATE TABLE IF NOT EXISTS intelligence_suggestions (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  run_id BIGINT NOT NULL UNIQUE REFERENCES intelligence_runs(id) ON DELETE RESTRICT,
  provider VARCHAR(16) NOT NULL CHECK(provider IN ('local','openai')),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  decision VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','accepted','discarded')),
  decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK((decision='pending' AND decided_at IS NULL) OR (decision<>'pending' AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_intelligence_suggestions_ticket ON intelligence_suggestions(ticket_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_intelligence_search ON tickets USING GIN(to_tsvector('simple',title||' '||description));
COMMIT;
