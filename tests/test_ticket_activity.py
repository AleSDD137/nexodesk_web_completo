"""V2.4 regression against an isolated PostgreSQL database and the real API.

Uses the V2.3.1 harness without inheriting/repeating its six tests. Requires
NEXODESK_TEST_DATABASE_URL naming a dedicated nexodesk_test_* database.
Fixtures and injected failures never touch an ordinary/personal database.
"""
import json
import os
import secrets
import subprocess
import unittest
from datetime import datetime
from pathlib import Path

from playwright.sync_api import expect
import test_requester_portal as harness


SQL_RUNNER = r"""
import pg from 'pg';
let text='';for await(const chunk of process.stdin)text+=chunk;
const input=JSON.parse(text);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  const {rows}=await pool.query('SELECT current_database() AS name');
  if(!rows[0].name.startsWith('nexodesk_test_'))throw Error('Refusing non-test database');
  const result=await pool.query(input.sql,input.params||[]);
  console.log(JSON.stringify(Array.isArray(result)?result.map(r=>r.rows):result.rows));
}finally{await pool.end();}
"""


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class TicketActivity(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login
    login = harness.RequesterPortal.login
    screenshot = harness.RequesterPortal.screenshot
    assert_readable = harness.RequesterPortal.assert_readable

    def sql(self, statement, params=None):
        result = subprocess.run(['node', '--input-type=module', '-e', SQL_RUNNER],
                                cwd=harness.ROOT / 'backend',
                                env=dict(os.environ, DATABASE_URL=harness.DATABASE),
                                input=json.dumps({'sql': statement, 'params': params or []}),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, 'Isolated PostgreSQL verification failed: ' + result.stderr)
        return json.loads(result.stdout)

    def new_ticket(self, context=None, portal=False):
        context = context or self.api_login('tech')
        title = 'Actividad ' + secrets.token_hex(8)
        body = {'type': 'Incidente', 'title': title, 'description': 'Diagnóstico y colaboración técnica.'}
        path = '/portal/requests' if portal else '/tickets'
        if not portal:
            body['requester'] = self.accounts['requester']['name']
            body['requesterEmail'] = self.accounts['requester']['email']
        response = self.api(context, 'POST', path, body)
        self.assertEqual(response.status, 201)
        return int(response.json()['data']['id'])

    def activity(self, context, ticket):
        response = self.api(context, 'GET', f'/tickets/{ticket}/activity')
        self.assertEqual(response.status, 200)
        return response.json()['data']

    def test_a_creation_changes_close_reopen_and_noop(self):
        staff = self.api_login('tech')
        employee = self.api_login('requester')
        for context, portal, author in [(staff, False, 'tech'), (employee, True, 'requester')]:
            ticket = self.new_ticket(context, portal)
            events = self.activity(staff, ticket)
            created = [e for e in events if e['kind'] == 'created']
            self.assertEqual(len(created), 1)
            self.assertEqual(int(created[0]['actor']['id']), self.accounts[author]['id'])
            self.assertEqual(created[0]['actor']['name'], self.accounts[author]['name'])
            self.assertIsNotNone(created[0]['occurredAt'])
        before = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        updates = {'status': 'En atención', 'priority': 'Alta', 'assignee': self.accounts['tech']['name'],
                   'title': 'Asunto actualizado', 'description': 'Detalle actualizado y comprobado.', 'type': 'Consulta'}
        self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', updates).status, 200)
        changes = [e for e in self.activity(staff, ticket) if e['source'] == 'ticket']
        self.assertEqual(len(changes), 2, 'One PATCH must produce one event with all changed fields')
        for field, value in updates.items():
            self.assertEqual(changes[-1]['changes'][field], {'old': before[field], 'new': value})
        self.assertEqual(int(changes[-1]['actor']['id']), self.accounts['tech']['id'])
        self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', updates).status, 200)
        self.assertEqual(len(self.activity(staff, ticket)), 2, 'A no-op must not duplicate audit')
        for status, kind, previous in [('Cerrado', 'closed', 'En atención'), ('En revisión', 'reopened', 'Cerrado')]:
            self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', {'status': status}).status, 200)
            event = self.activity(staff, ticket)[-1]
            self.assertEqual(event['kind'], kind)
            self.assertEqual(event['changes']['status'], {'old': previous, 'new': status})
        self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', {'actor_id': self.accounts['admin']['id']}).status, 400)

    def test_b_private_notes_authorization_public_comments_and_persistence(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        employee, other, anonymous = self.api_login('requester'), self.api_login('other'), self.context()
        content = 'Nota interna privada ' + secrets.token_hex(8)
        for key in ['tech', 'tech2', 'tech3', 'coordinator', 'admin']:
            context = self.api_login(key)
            response = self.api(context, 'POST', f'/tickets/{ticket}/notes', {'content': content + ' ' + key})
            self.assertEqual(response.status, 201)
            self.assertEqual(self.api(context, 'GET', f'/tickets/{ticket}/notes').status, 200)
            self.assertTrue(self.activity(context, ticket))
        notes = [e for e in self.activity(staff, ticket) if e['source'] == 'note']
        self.assertEqual(len(notes), 5)
        self.assertEqual({int(e['actor']['id']) for e in notes}, {self.accounts[k]['id'] for k in ['tech', 'tech2', 'tech3', 'coordinator', 'admin']})
        for body in [{'content': ''}, {'content': '   '}, {'content': 'x' * 5001},
                     {'content': 'No falsificar autor', 'author_id': self.accounts['admin']['id']},
                     {'content': 'No falsificar fecha', 'created_at': '2000-01-01T00:00:00Z'}]:
            self.assertEqual(self.api(staff, 'POST', f'/tickets/{ticket}/notes', body).status, 400)
        for context, expected in [(employee, 403), (other, 403), (anonymous, 401)]:
            for method, path in [('GET', f'/tickets/{ticket}/activity'), ('GET', f'/tickets/{ticket}/notes'),
                                 ('POST', f'/tickets/{ticket}/notes'), ('GET', '/tickets/9007199254740990/activity')]:
                self.assertEqual(self.api(context, method, path, {'content': content} if method == 'POST' else None).status, expected)
        for path in [f'/tickets/{ticket}', f'/portal/requests/{ticket}']:
            self.assertEqual(self.api(other, 'GET', path).status, 403)
            own = self.api(employee, 'GET', path)
            self.assertEqual(own.status, 200)
            self.assertNotIn(content, own.text())
            self.assertNotIn('notes', own.json()['data'])
        count = len(self.activity(staff, ticket))
        comment = 'Comentario público conservado ' + secrets.token_hex(5)
        self.assertEqual(self.api(employee, 'POST', f'/tickets/{ticket}/comments', {'text': comment}).status, 201)
        activity = self.activity(staff, ticket)
        self.assertEqual(len(activity), count + 1, 'Public comments must occur once, without copied audit events')
        self.assertEqual(len([e for e in activity if e['kind'] == 'public_comment' and e['text'] == comment]), 1)
        self.assertEqual(int([e for e in activity if e['kind'] == 'public_comment' and e['text'] == comment][0]['actor']['id']),
                         self.accounts['requester']['id'])
        public = self.api(employee, 'GET', f'/portal/requests/{ticket}').json()['data']
        self.assertEqual(public['comments'][-1]['text'], comment)
        self.assertNotIn(content, json.dumps(public))
        self.assertEqual(self.api(staff, 'POST', '/auth/logout', {}).status, 200)
        again = self.api_login('tech')
        self.assertEqual(len([e for e in self.activity(again, ticket) if e['source'] == 'note']), 5)

    def test_c_triage_sources_and_ticket_changes_without_duplicates(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        diagnosis = {'category': 'Redes / VPN', 'impact': 'Alto', 'urgency': 'Alta',
                     'diagnosis': 'Diagnóstico documentado.', 'newTest': 'Conectividad comprobada.', 'applyPriority': True}
        self.assertEqual(self.api(staff, 'PUT', f'/triage/{ticket}', diagnosis).status, 200)
        transfer = {'toLevel': 2, 'reason': 'Requiere revisión de especialista.',
                    'pending': 'Continuar comprobaciones de red.', 'assigneeUserId': self.accounts['tech2']['id']}
        self.assertEqual(self.api(staff, 'POST', f'/triage/{ticket}/transfer', transfer).status, 200)
        timeline = self.activity(staff, ticket)
        self.assertEqual(len({e['id'] for e in timeline}), len(timeline))
        self.assertEqual(len([e for e in timeline if e['kind'] == 'diagnosis']), 1)
        self.assertEqual(len([e for e in timeline if e['kind'] == 'transfer']), 1)
        triage = self.api(staff, 'GET', f'/triage/{ticket}').json()['data']
        self.assertEqual(len(triage['history']), 2)
        self.assertEqual(len(triage['tests']), 1)
        self.assertEqual(triage['diagnosis'], diagnosis['diagnosis'])
        self.assertEqual(triage['level'], 2)
        ticket_events = [e for e in timeline if e['source'] == 'ticket']
        changes = [e['changes'] for e in ticket_events if e['kind'] != 'created']
        self.assertTrue(any(c.get('priority') == {'old': 'Media', 'new': 'Alta'} for c in changes))
        self.assertTrue(any(c.get('assignee') == {'old': 'Sin asignar', 'new': self.accounts['tech2']['name']} for c in changes))

    def test_d_chronology_ties_legacy_dates_and_incremental_migration(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        before = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        old_date = '2020-02-03T10:20:30.000Z'
        comments = [{'author': 'Autor histórico', 'date': '21/10/2020 14:30', 'text': 'Fecha local no interpretable'},
                    {'author': 'Autor histórico', 'date': old_date, 'text': 'Fecha ISO registrada'}]
        self.sql('UPDATE tickets SET comments=$1::jsonb WHERE id=$2', [json.dumps(comments), ticket])
        # Equal timestamps across sources and source-local IDs exercise tie ordering.
        for content in ['Empate A', 'Empate B']:
            self.sql('INSERT INTO ticket_internal_notes(ticket_id,author_id,author_name,content,created_at) VALUES($1,$2,$3,$4,$5)',
                     [ticket, self.accounts['tech']['id'], self.accounts['tech']['name'], content, old_date])
        timeline = self.activity(staff, ticket)
        dated = [datetime.fromisoformat(e['occurredAt'].replace('Z', '+00:00')) for e in timeline if e['occurredAt']]
        self.assertEqual(dated, sorted(dated))
        self.assertEqual([e['id'] for e in timeline], [e['id'] for e in self.activity(staff, ticket)])
        unknown = [e for e in timeline if e['kind'] == 'public_comment' and e['text'] == comments[0]['text']][0]
        self.assertIsNone(unknown['occurredAt'])
        self.assertEqual(unknown['recordedDate'], comments[0]['date'])
        self.assertEqual(timeline[-1]['id'], unknown['id'])
        # A SQL-created fixture is a pre-V2.4 ticket with no inferred actor.
        legacy = self.sql('INSERT INTO tickets(title,requester,created_at) VALUES($1,$2,$3) RETURNING id',
                          ['Histórico documentado', 'Solicitante histórico', old_date])[0]['id']
        preserve_sql = 'SELECT count(*) AS n FROM users UNION ALL SELECT count(*) FROM tickets UNION ALL SELECT count(*) FROM assets UNION ALL SELECT count(*) FROM triage_cases UNION ALL SELECT count(*) FROM triage_tests UNION ALL SELECT count(*) FROM triage_events'
        preserved = self.sql(preserve_sql)
        migration = (harness.ROOT / 'backend/sql/005_ticket_activity.sql').read_text()
        self.sql(migration)
        self.sql(migration)
        self.assertEqual(self.sql(preserve_sql), preserved)
        legacy_events = self.activity(staff, int(legacy))
        self.assertEqual(len(legacy_events), 1)
        self.assertEqual(legacy_events[0]['kind'], 'created')
        self.assertIsNone(legacy_events[0]['actor']['id'])
        self.assertIsNone(legacy_events[0]['actor']['name'])
        self.assertTrue(legacy_events[0]['context']['recordedBeforeV24'])
        self.assertEqual(datetime.fromisoformat(legacy_events[0]['occurredAt'].replace('Z', '+00:00')),
                         datetime.fromisoformat(old_date.replace('Z', '+00:00')))
        self.assertEqual(self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']['title'], before['title'])
        self.assertEqual(self.sql('SELECT comments FROM tickets WHERE id=$1', [ticket])[0]['comments'], comments)

    def test_e_transactions_roll_back_when_audit_write_fails(self):
        staff = self.api_login('tech')
        employee = self.api_login('requester')
        ticket = self.new_ticket(staff)
        before = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        before_activity = self.activity(staff, ticket)
        suffix = secrets.token_hex(6)
        function = 'v24_test_fail_' + suffix
        trigger = 'v24_test_trigger_' + suffix
        self.sql(f"CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected V2.4 test failure'; END $$; CREATE TRIGGER {trigger} BEFORE INSERT ON ticket_events FOR EACH ROW EXECUTE FUNCTION {function}()")
        try:
            for context, path, form in [(staff, '/tickets', {'requester': 'Prueba'}), (employee, '/portal/requests', {})]:
                title = 'Alta debe revertirse ' + secrets.token_hex(8)
                body = dict(form, title=title, description='Comprobar atomicidad.', type='Incidente')
                self.assertEqual(self.api(context, 'POST', path, body).status, 500)
                self.assertEqual(int(self.sql('SELECT count(*) AS n FROM tickets WHERE title=$1', [title])[0]['n']), 0)
            self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', {'status': 'Cerrado', 'priority': 'Alta'}).status, 500)
            after = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
            self.assertEqual(after, before)
            diagnosis = {'category': 'Redes / VPN', 'impact': 'Alto', 'urgency': 'Alta',
                         'diagnosis': 'Esta escritura debe revertirse.', 'newTest': 'Prueba también reversible.', 'applyPriority': True}
            self.assertEqual(self.api(staff, 'PUT', f'/triage/{ticket}', diagnosis).status, 500)
            self.assertEqual(int(self.sql('SELECT count(*) AS n FROM triage_cases WHERE ticket_id=$1', [ticket])[0]['n']), 0)
            self.assertEqual(int(self.sql('SELECT count(*) AS n FROM triage_tests WHERE ticket_id=$1', [ticket])[0]['n']), 0)
            self.assertEqual(int(self.sql('SELECT count(*) AS n FROM triage_events WHERE ticket_id=$1', [ticket])[0]['n']), 0)
            self.assertEqual(self.activity(staff, ticket), before_activity)
        finally:
            self.sql(f'DROP TRIGGER {trigger} ON ticket_events; DROP FUNCTION {function}()')

    def test_e2_note_failure_does_not_change_ticket_or_create_activity(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        before = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        before_activity = self.activity(staff, ticket)
        suffix = secrets.token_hex(6)
        function, trigger = 'v24_test_note_fail_' + suffix, 'v24_test_note_trigger_' + suffix
        self.sql(f"CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected V2.4 note failure'; END $$; CREATE TRIGGER {trigger} BEFORE INSERT ON ticket_internal_notes FOR EACH ROW EXECUTE FUNCTION {function}()")
        try:
            self.assertEqual(self.api(staff, 'POST', f'/tickets/{ticket}/notes', {'content': 'La nota no debe confirmarse.'}).status, 500)
            self.assertEqual(self.api(staff, 'GET', f'/tickets/{ticket}/notes').json()['data'], [])
            self.assertEqual(self.api(staff, 'GET', f'/tickets/{ticket}').json()['data'], before)
            self.assertEqual(self.activity(staff, ticket), before_activity)
        finally:
            self.sql(f'DROP TRIGGER {trigger} ON ticket_internal_notes; DROP FUNCTION {function}()')

    def test_e3_fresh_001_to_004_data_survives_005(self):
        # A fresh schema inside the isolated database validates applying 005 to
        # an actual 001–004 installation, not merely rerunning it on a V2.4 one.
        schema = 'v24_compat_' + secrets.token_hex(6)
        initial = '\n'.join((harness.ROOT / 'backend/sql' / name).read_text() for name in
                            ['001_init.sql', '002_frontend_compat.sql', '003_auth.sql', '004_assets_triage_portal.sql'])
        fixture = """
        INSERT INTO users(name,email,role,support_level) VALUES('Técnico histórico','legacy@example.test','Técnico',1);
        INSERT INTO tickets(id,title,requester,comments,created_at) VALUES(501,'Caso histórico','Persona histórica',
          '[{"author":"Usuario histórico","date":"2020-02-03T10:20:30Z","text":"Comentario previo"}]','2020-02-03T10:20:30Z');
        INSERT INTO assets(kind,brand,serial,owner_name,location,state,ticket_id)
          VALUES('Notebook','Equipo histórico','LEGACY-501','Persona histórica','Oficina','Asignado',501);
        INSERT INTO triage_cases(ticket_id,diagnosis,updated_by) VALUES(501,'Diagnóstico previo',1);
        INSERT INTO triage_tests(ticket_id,description,created_by) VALUES(501,'Prueba previa',1);
        INSERT INTO triage_events(ticket_id,kind,note,created_by,created_at)
          VALUES(501,'Diagnóstico actualizado','Resumen previo',1,'2020-02-03T11:20:30Z');
        """
        snapshot = """SELECT 'preserved' AS marker,jsonb_build_object(
          'users',(SELECT jsonb_agg(u) FROM users u),
          'tickets',(SELECT jsonb_agg(t) FROM tickets t),
          'assets',(SELECT jsonb_agg(a) FROM assets a),
          'cases',(SELECT jsonb_agg(c) FROM triage_cases c),
          'tests',(SELECT jsonb_agg(t) FROM triage_tests t),
          'events',(SELECT jsonb_agg(e) FROM (SELECT id,ticket_id,kind,note,pending,created_by,created_at,from_level,to_level FROM triage_events) e)
        ) AS payload;"""
        migration = (harness.ROOT / 'backend/sql/005_ticket_activity.sql').read_text()
        result = self.sql(f'CREATE SCHEMA {schema}; SET search_path TO {schema};\n' + initial + fixture + snapshot +
                          migration + migration + snapshot +
                          "SELECT 'creation' AS marker,kind,actor_id,actor_name,occurred_at,changes,context FROM ticket_events WHERE ticket_id=501;")
        rows = [row for batch in result for row in batch]
        snapshots = [r['payload'] for r in rows if r.get('marker') == 'preserved']
        self.assertEqual(len(snapshots), 2)
        self.assertEqual(snapshots[0], snapshots[1])
        creation = [r for r in rows if r.get('marker') == 'creation']
        self.assertEqual(len(creation), 1)
        self.assertEqual(creation[0]['kind'], 'created')
        self.assertIsNone(creation[0]['actor_id'])
        self.assertIsNone(creation[0]['actor_name'])
        self.assertEqual(creation[0]['changes'], {})
        self.assertTrue(creation[0]['context']['recordedBeforeV24'])
        self.assertEqual(datetime.fromisoformat(creation[0]['occurred_at'].replace('Z', '+00:00')),
                         datetime.fromisoformat('2020-02-03T10:20:30+00:00'))

    def test_f_browser_activity_notes_reload_and_requester_exclusion(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        context = self.context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        self.login(page, 'tech')
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        expect(page.locator('#ticketActivity')).to_be_visible()
        expect(page.locator('[data-activity-id]')).to_have_count(1)
        content = 'Colaboración privada comprobada ' + secrets.token_hex(6)
        page.locator('#internalNoteForm [name=content]').fill(content)
        page.locator('#internalNoteForm [type=submit]').click()
        expect(page.locator('#ticketActivity')).to_contain_text(content)
        page.reload()
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        expect(page.locator('#ticketActivity')).to_contain_text(content)
        for width in [1440, 390]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.locator('#ticketActivity').scroll_into_view_if_needed()
            directory = os.environ.get('NEXODESK_SCREENSHOTS')
            if directory:
                path = Path(directory)
                path.mkdir(parents=True, exist_ok=True)
                page.locator('#detailDialog').screenshot(path=str(path / f'ticket-activity-{width}.png'))
            overflow = page.evaluate("""()=>({width:innerWidth,page:document.documentElement.scrollWidth,
              elements:[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&
                e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,id:e.id,cls:e.className,
                  right:e.getBoundingClientRect().right}))})""")
            self.assertLessEqual(overflow['page'], width, overflow)
        page.locator('#closeDetail').click()
        self.login(page, 'requester')
        page.locator(f'[data-portal-id="{ticket}"]').click()
        expect(page.locator('#nxLookupResult')).to_be_visible()
        expect(page.locator('#internalNoteForm')).to_have_count(0)
        self.assertNotIn(content, page.locator('body').inner_text())
        self.assertFalse(errors, errors)

    def test_g_keyboard_contrast_and_uncertain_note_requires_read_before_retry(self):
        staff = self.api_login('tech')
        ticket = self.new_ticket(staff)
        context = self.context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        self.login(page, 'tech')
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        expect(page.locator('#ticketActivity [role=status]')).to_have_attribute('data-state', 'ready')
        self.assert_readable(page, '#detailDialog')
        page.locator('#internalNoteForm [name=content]').focus()
        page.keyboard.press('Tab')
        expect(page.locator('#internalNoteForm [type=submit]')).to_be_focused()
        self.assertEqual(page.locator('#internalNoteForm [type=submit]').evaluate('(e)=>getComputedStyle(e).outlineStyle'), 'solid')
        draft = 'Conservar borrador ante resultado incierto ' + secrets.token_hex(6)
        page.locator('#internalNoteForm [name=content]').fill(draft)
        headers = {'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'}
        def unavailable(route):
            route.fulfill(status=503, json={'error': 'Servicio temporalmente no disponible'}, headers=headers)
        # Simulate an unknown outcome: no client-side retry/local copy is safe.
        page.route(f'**/api/tickets/{ticket}/notes', unavailable, times=1)
        page.locator('#internalNoteForm [type=submit]').click()
        expect(page.locator('#ticketActivity [role=status]')).to_have_attribute('data-state', 'error')
        expect(page.locator('#ticketActivity')).to_contain_text('No se pudo confirmar')
        expect(page.locator('#internalNoteForm [type=submit]')).to_be_disabled()
        expect(page.locator('#internalNoteForm [name=content]')).to_have_value(draft)
        self.assertEqual(self.api(staff, 'GET', f'/tickets/{ticket}/notes').json()['data'], [])
        page.locator('#refreshTicketActivity').click()
        expect(page.locator('#internalNoteForm [type=submit]')).to_be_enabled()
        expect(page.locator('#internalNoteForm [name=content]')).to_have_value(draft)
        # Confirmed POST + failed following GET must never resubmit the note.
        page.route(f'**/api/tickets/{ticket}/activity', unavailable, times=1)
        page.locator('#internalNoteForm [type=submit]').click()
        expect(page.locator('#ticketActivity [role=status]')).to_have_attribute('data-state', 'error')
        expect(page.locator('#internalNoteForm [name=content]')).to_have_value('')
        self.assertEqual(len(self.api(staff, 'GET', f'/tickets/{ticket}/notes').json()['data']), 1)
        page.locator('#refreshTicketActivity').click()
        expect(page.locator('#ticketActivity')).to_contain_text(draft)
        self.assertEqual(len(self.api(staff, 'GET', f'/tickets/{ticket}/notes').json()['data']), 1)
        self.assertFalse(errors, errors)


if __name__ == '__main__':
    unittest.main()
