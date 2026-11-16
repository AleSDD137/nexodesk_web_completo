BEGIN;
CREATE TABLE IF NOT EXISTS sla_policies (
 priority VARCHAR(12) PRIMARY KEY CHECK(priority IN ('Baja','Media','Alta','Crítica')),
 response_minutes INTEGER NOT NULL CHECK(response_minutes BETWEEN 1 AND 10080),
 resolution_minutes INTEGER NOT NULL CHECK(resolution_minutes BETWEEN response_minutes AND 10080),
 timezone VARCHAR(80) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
 weekdays INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}' CHECK(cardinality(weekdays)>0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
 start_minute INTEGER NOT NULL DEFAULT 540 CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute INTEGER NOT NULL DEFAULT 1080 CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute>start_minute),
 warning_minutes INTEGER NOT NULL DEFAULT 30 CHECK(warning_minutes BETWEEN 0 AND 1440),
 escalation_enabled BOOLEAN NOT NULL DEFAULT false,
 escalation_level SMALLINT NOT NULL DEFAULT 2 CHECK(escalation_level IN (2,3)),
 enabled BOOLEAN NOT NULL DEFAULT true,
 updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO sla_policies(priority,response_minutes,resolution_minutes) VALUES
 ('Crítica',30,240),('Alta',60,480),('Media',240,1080),('Baja',480,2160) ON CONFLICT(priority) DO NOTHING;
CREATE TABLE IF NOT EXISTS ticket_sla (
 ticket_id BIGINT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
 policy JSONB NOT NULL CHECK(jsonb_typeof(policy)='object'),
 started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 response_due_at TIMESTAMPTZ NOT NULL,
 resolution_due_at TIMESTAMPTZ NOT NULL,
 first_response_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ,
 cycle INTEGER NOT NULL DEFAULT 1 CHECK(cycle>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_ticket_sla_deadlines ON ticket_sla(resolution_due_at,ticket_id);
CREATE TABLE IF NOT EXISTS sla_alerts (
 id BIGSERIAL PRIMARY KEY,
 ticket_id BIGINT NOT NULL REFERENCES ticket_sla(ticket_id) ON DELETE CASCADE,
 cycle INTEGER NOT NULL CHECK(cycle>0),
 kind VARCHAR(32) NOT NULL CHECK(kind IN ('response_warning','response_breach','resolution_warning','resolution_breach','escalation')),
 target_level SMALLINT CHECK(target_level IN (2,3)),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 acknowledged_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 acknowledged_at TIMESTAMPTZ,
 UNIQUE(ticket_id,cycle,kind)
);
CREATE INDEX IF NOT EXISTS idx_sla_alerts_recent ON sla_alerts(created_at DESC,id DESC);
COMMIT;
