BEGIN;
CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('Notebook','Tablet','Teléfono','Monitor','Impresora','Otro')),
  brand VARCHAR(100) NOT NULL,
  serial VARCHAR(70) NOT NULL,
  owner_name VARCHAR(120) NOT NULL DEFAULT 'Sin asignar',
  location VARCHAR(120) NOT NULL,
  state VARCHAR(30) NOT NULL CHECK (state IN ('Disponible','Asignado','En reparación','Baja')),
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial_ci ON assets(lower(serial));
CREATE INDEX IF NOT EXISTS idx_assets_ticket ON assets(ticket_id);
CREATE TABLE IF NOT EXISTS triage_cases (
  ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  category VARCHAR(60) NOT NULL DEFAULT 'Sin clasificar',
  impact VARCHAR(12) NOT NULL DEFAULT 'Medio' CHECK (impact IN ('Bajo','Medio','Alto')),
  urgency VARCHAR(12) NOT NULL DEFAULT 'Media' CHECK (urgency IN ('Baja','Media','Alta')),
  level SMALLINT NOT NULL DEFAULT 1 CHECK(level BETWEEN 1 AND 3),
  diagnosis TEXT NOT NULL DEFAULT '',
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS triage_tests (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES triage_cases(ticket_id) ON DELETE CASCADE,
  description VARCHAR(750) NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_tests_ticket ON triage_tests(ticket_id,id);
CREATE TABLE IF NOT EXISTS triage_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES triage_cases(ticket_id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL CHECK(kind IN ('Diagnóstico actualizado','Transferencia')),
  from_level SMALLINT CHECK(from_level BETWEEN 1 AND 3),
  to_level SMALLINT CHECK(to_level BETWEEN 1 AND 3),
  note TEXT NOT NULL DEFAULT '',
  pending TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_triage_events_ticket ON triage_events(ticket_id,id DESC);
COMMIT;
