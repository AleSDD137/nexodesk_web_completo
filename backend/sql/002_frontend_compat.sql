BEGIN;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'Dashboard';
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_type_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_type_check CHECK(type IN ('Incidente','Requerimiento','Consulta'));
COMMIT;
