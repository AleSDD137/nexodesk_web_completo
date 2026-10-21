BEGIN;
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  role VARCHAR(24) NOT NULL CHECK(role IN ('Administrador','Coordinador','Técnico','Solicitante')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type VARCHAR(20) NOT NULL DEFAULT 'Incidente' CHECK(type IN ('Incidente','Requerimiento')),
  priority VARCHAR(12) NOT NULL DEFAULT 'Media' CHECK(priority IN ('Baja','Media','Alta','Crítica')),
  status VARCHAR(24) NOT NULL DEFAULT 'Registrado' CHECK(status IN ('Registrado','En revisión','En atención','Validación','Cerrado')),
  requester VARCHAR(120) NOT NULL,
  assignee VARCHAR(120) NOT NULL DEFAULT 'Sin asignar',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
COMMIT;
