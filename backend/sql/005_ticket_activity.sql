BEGIN;
CREATE TABLE IF NOT EXISTS ticket_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('created','updated','closed','reopened')),
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(120),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  context JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_ticket_events_timeline ON ticket_events(ticket_id,occurred_at,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_events_creation ON ticket_events(ticket_id) WHERE kind='created';

CREATE TABLE IF NOT EXISTS ticket_internal_notes (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(120) NOT NULL,
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_ticket_internal_notes_timeline ON ticket_internal_notes(ticket_id,created_at,id);

-- Enrich future Triage events in their original source, never copy them.
ALTER TABLE triage_events ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object');
ALTER TABLE triage_events ADD COLUMN IF NOT EXISTS actor_name VARCHAR(120);
CREATE INDEX IF NOT EXISTS idx_triage_events_timeline ON triage_events(ticket_id,created_at,id);

-- The creation timestamp is documented by tickets.created_at. The original
-- actor, initial values and intervening changes are unknown: do not infer them.
INSERT INTO ticket_events(ticket_id,kind,occurred_at,context)
SELECT id,'created',created_at,'{"origin":"legacy","recordedBeforeV24":true}'::jsonb FROM tickets
ON CONFLICT (ticket_id) WHERE kind='created' DO NOTHING;
COMMIT;
