BEGIN;
CREATE TABLE IF NOT EXISTS asset_events (
  id BIGSERIAL PRIMARY KEY,
  asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(120),
  kind VARCHAR(30) NOT NULL CHECK(kind IN ('created','updated','imported','owner_linked')),
  changes JSONB NOT NULL CHECK(jsonb_typeof(changes)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_asset_events_history ON asset_events(asset_id,created_at DESC,id DESC);
-- Existing assignments/movements are unknown: do not invent a historical baseline.
COMMIT;
