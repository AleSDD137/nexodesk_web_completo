BEGIN;
-- Existing owner_name is historical text, never a basis for guessing users.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_assets_owner_user ON assets(owner_user_id);

-- Additional links only. assets.ticket_id remains the compatible principal.
CREATE TABLE IF NOT EXISTS asset_ticket_links (
  asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(asset_id,ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_ticket_links_ticket ON asset_ticket_links(ticket_id,asset_id);

-- Pulse reads the existing audit sources; it does not store copied events.
CREATE INDEX IF NOT EXISTS idx_ticket_events_recent ON ticket_events(occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_triage_events_recent ON triage_events(created_at DESC,id DESC);
COMMIT;
