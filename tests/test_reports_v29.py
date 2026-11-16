"""V2.9 SQL aggregates/CSV/role regression against dedicated PostgreSQL only."""
import csv
import io
import secrets
import unittest
from urllib.parse import urlencode

import test_requester_portal as harness
import test_pulse_relations as pulse


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class Reports(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login
    sql = pulse.PulseRelations.sql
    ticket = pulse.PulseRelations.ticket

    def report(self, context, **filters):
        response = self.api(context, 'GET', '/reports/summary?' + urlencode(filters))
        self.assertEqual(response.status, 200, response.text())
        return response.json()['data']

    def test_a_manager_permissions_and_filter_validation(self):
        for key, expected in [('admin',200),('coordinator',200),('tech',403),('tech2',403),('requester',403)]:
            context = self.api_login(key)
            for path in ['/reports/summary','/reports/export','/reports/export.csv']:
                self.assertEqual(self.api(context,'GET',path).status,expected,(key,path))
        self.assertEqual(self.api(self.context(),'GET','/reports/summary').status,401)
        manager=self.api_login('admin')
        for query in ['from=2026-02-30','from=0000-01-01','from=2026-04-01&to=2026-03-01','priority=Urgente','state=Registrado']:
            self.assertEqual(self.api(manager,'GET','/reports/summary?'+query).status,400,query)

    def test_b_complete_cohort_exceeds_ticket_page_and_filters_match_sql(self):
        manager=self.api_login('admin')
        marker='V29-'+secrets.token_hex(8)
        rows=self.sql("""INSERT INTO tickets(title,requester,assignee,status,priority,created_at)
          SELECT 'Red corporativa caída','Prueba',$1,CASE WHEN g%2=0 THEN 'Cerrado' ELSE 'Registrado' END,'Alta',
          '1899-02-03T12:00:00Z'::timestamptz FROM generate_series(1,225)g RETURNING id""",[marker])
        self.sql("INSERT INTO triage_cases(ticket_id,category,level) VALUES($1,'Redes / VPN',3)",[rows[0]['id']])
        data=self.report(manager,**{'from':'1899-02-03','to':'1899-02-03','assignee':marker})
        self.assertEqual(data['totals']['created'],225)
        self.assertEqual(data['totals']['open'],113)
        self.assertEqual(sum(r['count'] for r in data['byPriority']),225)
        self.assertEqual(sum(r['count'] for r in data['byCategory']),225)
        self.assertEqual(data['recurrence']['groups'][0]['count'],225)
        self.assertEqual(data['escalations']['l3'],1)
        filtered=self.report(manager,assignee=marker,category='Redes / VPN',priority='Alta')
        self.assertEqual(filtered['totals']['created'],1)
        empty=self.report(manager,assignee="' OR true --")
        self.assertEqual(empty['totals']['created'],0)

    def test_c_timings_closure_cycles_and_unknown_history_are_explicit(self):
        staff=self.api_login('tech')
        first,unknown=self.ticket(staff),self.ticket(staff)
        marker='Timing-'+secrets.token_hex(8)
        self.sql("UPDATE tickets SET assignee=$1,created_at='1870-01-02T00:00:00Z',status='Cerrado' WHERE id=ANY($2::bigint[])",[marker,[first,unknown]])
        self.sql("""INSERT INTO ticket_events(ticket_id,kind,actor_id,occurred_at,changes) VALUES
          ($1,'closed',$2,'1870-01-02T02:00:00Z','{"status":{"old":"En atención","new":"Cerrado"}}'),
          ($1,'reopened',$2,'1870-01-02T03:00:00Z','{"status":{"old":"Cerrado","new":"En atención"}}'),
          ($1,'closed',$2,'1870-01-02T04:00:00Z','{"status":{"old":"En atención","new":"Cerrado"}}')""",[first,self.accounts['tech']['id']])
        self.sql("""INSERT INTO ticket_sla(ticket_id,policy,started_at,response_due_at,resolution_due_at,first_response_at,resolved_at)
          VALUES($1,'{}','1870-01-02T00:00:00Z','1870-01-02T01:00:00Z','1870-01-02T03:00:00Z','1870-01-02T00:30:00Z','1870-01-02T04:00:00Z')
          ON CONFLICT(ticket_id) DO UPDATE SET started_at=EXCLUDED.started_at,response_due_at=EXCLUDED.response_due_at,
          resolution_due_at=EXCLUDED.resolution_due_at,first_response_at=EXCLUDED.first_response_at,resolved_at=EXCLUDED.resolved_at""",[first])
        data=self.report(self.api_login('admin'),assignee=marker,**{'from':'1870-01-02','to':'1870-01-02'})
        self.assertEqual(data['totals']['created'],2)
        self.assertEqual(data['totals']['resolved'],1)
        self.assertEqual(data['totals']['closureEvents'],2)
        self.assertEqual(data['totals']['resolutionSamples'],1)
        self.assertEqual(data['totals']['avgResolutionMinutes'],240)
        self.assertEqual(data['totals']['firstResponseSamples'],1)
        self.assertEqual(data['totals']['avgFirstResponseMinutes'],30)
        self.assertEqual(data['sla']['responseMet'],1)
        self.assertEqual(data['sla']['resolutionMet'],0)
        self.assertGreaterEqual(data['sla']['resolutionBreached'],1)

    def test_d_interventions_use_actual_ids_not_current_assignee_and_reject_bad_dates(self):
        staff=self.api_login('tech')
        ticket=self.ticket(staff)
        marker='NoActor-'+secrets.token_hex(8)
        self.sql("UPDATE tickets SET assignee=$1,created_at='1880-03-01T00:00:00Z' WHERE id=$2",[marker,ticket])
        self.sql("""INSERT INTO ticket_events(ticket_id,kind,actor_id,occurred_at,changes)
          VALUES($1,'updated',$2,'1880-03-02T01:00:00Z','{}'),($1,'updated',$2,'1880-03-02T02:00:00Z','{}')""",[ticket,self.accounts['tech']['id']])
        self.sql("""UPDATE tickets SET comments=jsonb_build_array(
          jsonb_build_object('authorId',$2::bigint,'date','1880-03-02T03:00:00.000000Z','text','Público'),
          jsonb_build_object('authorId',$3::bigint,'date','1880-03-02T04:00:00.000000Z','text','Empleado'),
          jsonb_build_object('authorId',$2::bigint,'date','hoy','text','Legado'),
          jsonb_build_object('authorId',$2::bigint,'date','1880-02-31T04:00:00.000000Z','text','Fecha inválida')
          ) WHERE id=$1""",[ticket,self.accounts['tech2']['id'],self.accounts['requester']['id']])
        data=self.report(self.api_login('admin'),assignee=marker,**{'from':'1880-03-02','to':'1880-03-02'})
        rows={str(r['userId']):r for r in data['interventions']}
        self.assertEqual(rows[str(self.accounts['tech']['id'])]['tickets'],1)
        self.assertEqual(rows[str(self.accounts['tech']['id'])]['events'],2)
        self.assertEqual(rows[str(self.accounts['tech2']['id'])]['tickets'],1)
        self.assertEqual(rows[str(self.accounts['tech2']['id'])]['events'],1)
        self.assertNotIn(str(self.accounts['requester']['id']),rows)
        self.assertEqual(data['totals']['created'],0,'Event cohort differs intentionally from creation cohort')

    def test_e_csv_export_is_authorized_complete_and_formula_safe(self):
        manager=self.api_login('admin')
        marker='CSV-'+secrets.token_hex(8)
        self.sql("INSERT INTO tickets(title,requester,assignee,created_at) VALUES('CSV','Prueba',$1,'1850-01-01T00:00:00Z')",[marker])
        ticket=self.sql('SELECT id FROM tickets WHERE assignee=$1',[marker])[0]['id']
        self.sql("INSERT INTO triage_cases(ticket_id,category) VALUES($1,E'\\t=HYPERLINK(\"x\")')",[ticket])
        response=self.api(manager,'GET','/reports/export?'+urlencode({'assignee':marker}))
        self.assertEqual(response.status,200)
        export=response.json()
        self.assertEqual(export['mime'],'text/csv;charset=utf-8')
        rows=list(csv.reader(io.StringIO(export['content'].lstrip('\ufeff'))))
        categories=[r for r in rows if r[0]=='Categoría']
        self.assertTrue(categories[0][1].startswith("'\t="),categories)
        raw=self.api(manager,'GET','/reports/export.csv?'+urlencode({'assignee':marker}))
        self.assertEqual(raw.status,200)
        self.assertIn('text/csv',raw.headers['content-type'])


if __name__=='__main__':
    unittest.main()
