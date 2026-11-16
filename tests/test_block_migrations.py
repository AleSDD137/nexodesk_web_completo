"""Incremental 007-009 upgrade of populated V2.5, on guarded isolated PostgreSQL."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import unittest
import test_requester_portal as harness
from test_ticket_activity import SQL_RUNNER


@unittest.skipUnless(harness.DATABASE, 'Set isolated NEXODESK_TEST_DATABASE_URL')
class BlockMigrations(unittest.TestCase):
    def sql(self, statement):
        result = subprocess.run(['node', '--input-type=module', '-e', SQL_RUNNER],
                                cwd=harness.ROOT / 'backend',
                                env=dict(os.environ, DATABASE_URL=harness.DATABASE),
                                input=json.dumps({'sql': statement, 'params': []}),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_upgrade_preserves_v25_data_and_all_migrations_can_repeat(self):
        migrations = sorted((harness.ROOT / 'backend/sql').glob('[0-9][0-9][0-9]_*.sql'))
        self.assertEqual(len(migrations), 9)
        schema = 'block_upgrade_' + secrets.token_hex(6)
        legacy = '\n'.join(p.read_text() for p in migrations[:6])
        additions = '\n'.join(p.read_text() for p in migrations[6:])
        fixture = """
          INSERT INTO users(id,name,email,role,support_level) VALUES(1,'Fixture conservado','migration@example.test','Técnico',1);
          INSERT INTO tickets(id,title,requester,comments) VALUES
            (1,'Ticket conservado','Fixture conservado','[{"author":"Fixture","text":"Público","date":"2020-01-01T12:00:00Z"}]'),
            (2,'Ticket adicional','Fixture conservado','[]');
          INSERT INTO assets(id,kind,brand,serial,owner_name,location,state,ticket_id,owner_user_id)
            VALUES(1,'Notebook','Equipo conservado','UPGRADE-001','Texto conservado','Oficina','Asignado',1,1);
          INSERT INTO asset_ticket_links(asset_id,ticket_id,created_by) VALUES(1,2,1);
          INSERT INTO triage_cases(ticket_id,diagnosis,updated_by) VALUES(1,'Diagnóstico conservado',1);
          INSERT INTO triage_tests(ticket_id,description,created_by) VALUES(1,'Prueba conservada',1);
          INSERT INTO triage_events(ticket_id,kind,note,created_by) VALUES(1,'Diagnóstico actualizado','Contexto',1);
          INSERT INTO ticket_events(ticket_id,kind,actor_id) VALUES(1,'created',1),(2,'created',1);
          INSERT INTO ticket_internal_notes(ticket_id,author_id,author_name,content) VALUES(1,1,'Fixture','Privada conservada');
        """
        tables = ['users', 'tickets', 'assets', 'asset_ticket_links', 'auth_sessions',
                  'triage_cases', 'triage_tests', 'triage_events',
                  'ticket_events', 'ticket_internal_notes']
        pairs = ','.join("'%s',(SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM %s x)" % (t, t) for t in tables)
        snapshot = "SELECT 'snapshot' AS marker,jsonb_build_object(" + pairs + ') AS data;'
        verify = """
          SELECT 'counts' AS marker,
            (SELECT count(*) FROM intelligence_suggestions)::int AS suggestions,
            (SELECT count(*) FROM intelligence_runs)::int AS runs,
            (SELECT count(*) FROM ticket_sla)::int AS enrolled,
            (SELECT count(*) FROM asset_events)::int AS movements,
            (SELECT count(*) FROM sla_alerts)::int AS alerts,
            (SELECT count(*) FROM sla_policies)::int AS policies;
        """
        result = self.sql(f'CREATE SCHEMA {schema}; SET search_path TO {schema};\n' +
                          legacy + fixture + snapshot + additions + snapshot +
                          '\n'.join(p.read_text() for p in migrations) + snapshot + verify)
        rows = [row for batch in result for row in batch]
        snapshots = [r['data'] for r in rows if r.get('marker') == 'snapshot']
        self.assertEqual(len(snapshots), 3)
        self.assertEqual(snapshots[0], snapshots[1])
        self.assertEqual(snapshots[0], snapshots[2])
        counts = next(r for r in rows if r.get('marker') == 'counts')
        self.assertEqual(counts, dict(marker='counts', suggestions=0, runs=0,
                                      enrolled=0, movements=0, alerts=0, policies=4))


if __name__ == '__main__':
    unittest.main()
