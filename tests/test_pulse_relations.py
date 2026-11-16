"""V2.5 real PostgreSQL/API regression. Requires a dedicated nexodesk_test_* DB.

The shared harness creates disposable fixture accounts in memory. SQL below
only targets the explicitly supplied test database; no personal DB is used.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import unittest

from playwright.sync_api import expect
import test_requester_portal as harness
from test_ticket_activity import SQL_RUNNER


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class PulseRelations(unittest.TestCase):
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

    def ticket(self, context, title=None):
        response = self.api(context, 'POST', '/tickets', {
            'title': title or 'Relación ' + secrets.token_hex(8),
            'description': 'Fixture de operaciones V2.5.', 'type': 'Incidente',
            'requester': self.accounts['requester']['name'],
            'requesterEmail': self.accounts['requester']['email'],
        })
        self.assertEqual(response.status, 201)
        return int(response.json()['data']['id'])

    def asset(self, context, principal=None, owner=None):
        fields = {'kind': 'Notebook', 'brand': 'Equipo V25 ' + secrets.token_hex(4),
                  'serial': 'V25-' + secrets.token_hex(8), 'owner': owner or self.accounts['requester']['name'],
                  'location': 'Ubicación V25 ' + secrets.token_hex(4), 'state': 'Asignado', 'ticketId': principal}
        response = self.api(context, 'POST', '/assets', fields)
        self.assertEqual(response.status, 201)
        return int(response.json()['data']['id']), fields

    def relation(self, context, asset):
        response = self.api(context, 'GET', f'/relations/assets/{asset}')
        self.assertEqual(response.status, 200)
        return response.json()['data']

    def test_a_pulse_global_totals_exceed_loaded_ticket_page_and_match_sql(self):
        staff = self.api_login('tech')
        marker = 'V25GLOBAL-' + secrets.token_hex(8)
        ids = self.sql("""INSERT INTO tickets(title,requester,requester_email,status,priority,assignee,created_at)
          SELECT $1||'-'||g,$2,$3,
            (ARRAY['Registrado','En revisión','En atención','Validación','Cerrado'])[1+(g%5)],
            (ARRAY['Baja','Media','Alta','Crítica'])[1+(g%4)],
            CASE WHEN g%3=0 THEN 'Sin asignar' ELSE $4 END,
            '1900-02-01T12:00:00Z'::timestamptz FROM generate_series(1,225) g RETURNING id""",
                       [marker, self.accounts['requester']['name'], self.accounts['requester']['email'], self.accounts['tech']['name']])
        self.sql("INSERT INTO triage_cases(ticket_id,level) VALUES($1,2),($2,3)", [ids[0]['id'], ids[1]['id']])
        response = self.api(staff, 'GET', '/pulse/summary?from=1900-02-01&to=1900-02-01')
        self.assertEqual(response.status, 200)
        data = response.json()['data']
        expected = self.sql("""SELECT count(*)::int AS total,
          count(*) FILTER(WHERE status<>'Cerrado')::int AS open,
          count(*) FILTER(WHERE status='En atención')::int AS "inProgress",
          count(*) FILTER(WHERE status='Validación')::int AS validation,
          count(*) FILTER(WHERE status='Cerrado')::int AS closed,
          count(*) FILTER(WHERE status<>'Cerrado' AND (btrim(assignee)='' OR assignee='Sin asignar'))::int AS unassigned
          FROM tickets WHERE created_at>='1900-02-01T00:00:00Z' AND created_at<'1900-02-02T00:00:00Z'""")[0]
        self.assertGreater(expected['total'], 200)
        self.assertEqual(data['totals'], expected)
        self.assertEqual(sum(row['count'] for row in data['byStatus']), expected['total'])
        self.assertEqual(sum(row['count'] for row in data['byPriority']), expected['total'])
        self.assertEqual(len(data['byStatus']), 5)
        self.assertEqual(len(data['byPriority']), 4)
        self.assertEqual(data['scope']['ticketBasis'], 'created_at')
        escalated = self.sql("""SELECT count(*) FILTER(WHERE c.level=2)::int AS l2,
          count(*) FILTER(WHERE c.level=3)::int AS l3 FROM triage_cases c JOIN tickets t ON t.id=c.ticket_id
          WHERE t.created_at>='1900-02-01T00:00:00Z' AND t.created_at<'1900-02-02T00:00:00Z'""")[0]
        self.assertEqual(data['escalated'], escalated)
        load = {row['assignee']: row for row in data['workload']}
        own = self.sql("""SELECT assignee,count(*)::int AS total,
          count(*) FILTER(WHERE status<>'Cerrado')::int AS open,
          count(*) FILTER(WHERE status='Cerrado')::int AS closed FROM tickets
          WHERE created_at>='1900-02-01T00:00:00Z' AND created_at<'1900-02-02T00:00:00Z' AND assignee=$1 GROUP BY assignee""",
                       [self.accounts['tech']['name']])[0]
        self.assertEqual(load[own['assignee']], own)
        self.assertTrue(data['generatedAt'])
        outside = self.api(staff, 'GET', '/pulse/summary?from=1900-02-02&to=1900-02-02').json()['data']
        self.assertEqual(outside['totals']['total'], 0)
        for query in ['from=not-a-date', 'from=1900-02-30', 'from=1900-02-02&to=1900-02-01']:
            self.assertEqual(self.api(staff, 'GET', '/pulse/summary?' + query).status, 400)

    def test_b_feed_is_bounded_stable_and_excludes_private_content(self):
        staff = self.api_login('tech')
        ticket = self.ticket(staff)
        private = 'PRIVATE-NOTE-V25-' + secrets.token_hex(8)
        self.assertEqual(self.api(staff, 'POST', f'/tickets/{ticket}/notes', {'content': private}).status, 201)
        self.sql("""INSERT INTO ticket_events(ticket_id,kind,actor_id,actor_name,occurred_at,changes)
          SELECT $1,'updated',$2,$3,'2004-03-01T12:00:00.123456Z',
          jsonb_build_object('status',jsonb_build_object('old','Registrado','new','En atención'),
            'description',jsonb_build_object('old',$4::text,'new',$4::text)) FROM generate_series(1,4)""",
                 [ticket, self.accounts['tech']['id'], self.accounts['tech']['name'], private])
        self.sql("INSERT INTO triage_cases(ticket_id,diagnosis) VALUES($1,$2)", [ticket, private])
        self.sql("""INSERT INTO triage_events(ticket_id,kind,created_by,note,pending,created_at,changes)
          VALUES($1,'Diagnóstico actualizado',$2,$3,$3,'2004-03-01T12:00:00.123456Z',
            jsonb_build_object('diagnosis',jsonb_build_object('old','', 'new',$3::text)))""",
                 [ticket, self.accounts['tech']['id'], private])
        query = '/pulse/activity?from=2004-03-01&to=2004-03-01&limit=2'
        cursor, seen, pages = None, [], 0
        while True:
            response = self.api(staff, 'GET', query + ('&cursor=' + cursor if cursor else ''))
            self.assertEqual(response.status, 200)
            self.assertNotIn(private, response.text())
            body = response.json()
            self.assertLessEqual(len(body['data']), 2)
            seen.extend(item['id'] for item in body['data'])
            pages += 1
            for item in body['data']:
                self.assertIn(item['source'], ['ticket', 'triage'])
                self.assertTrue(set(item['changes']) <= {'status','priority','assignee'})
            if not body['hasMore']:
                self.assertIsNone(body['nextCursor'])
                break
            cursor = body['nextCursor']
            self.assertTrue(cursor)
            self.assertLess(pages, 100)
        expected = self.sql("""SELECT 'event:'||id AS id FROM ticket_events
          WHERE occurred_at>='2004-03-01T00:00:00Z' AND occurred_at<'2004-03-02T00:00:00Z'
          UNION ALL SELECT 'triage:'||id FROM triage_events
          WHERE created_at>='2004-03-01T00:00:00Z' AND created_at<'2004-03-02T00:00:00Z'""")
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), {row['id'] for row in expected})
        first = self.api(staff, 'GET', query).json()
        self.assertEqual([e['id'] for e in first['data']], seen[:2])
        self.assertEqual(self.api(staff, 'GET', query + '&cursor=broken').status, 400)
        if first['nextCursor']:
            self.assertEqual(self.api(staff, 'GET', '/pulse/activity?from=2004-03-02&limit=2&cursor=' + first['nextCursor']).status, 400)

    def test_c_relations_preserve_principal_and_support_explicit_multiple_links(self):
        staff = self.api_login('tech')
        primary, extra = self.ticket(staff), self.ticket(staff)
        asset, original = self.asset(staff, primary)
        initial = self.relation(staff, asset)
        self.assertEqual(initial['asset']['ownerUserId'], None, 'Matching owner names must never infer an account')
        self.assertEqual(len(initial['tickets']), 1)
        self.assertTrue(initial['tickets'][0]['primary'])
        self.assertEqual(self.api(staff, 'POST', '/relations/links', {'assetId': asset, 'ticketId': primary}).status, 409)
        linked = self.api(staff, 'POST', '/relations/links', {'assetId': asset, 'ticketId': extra})
        self.assertEqual(linked.status, 201)
        self.assertEqual(int(linked.json()['data']['createdBy']), self.accounts['tech']['id'])
        self.assertEqual(self.api(staff, 'POST', '/relations/links', {'assetId': asset, 'ticketId': extra}).status, 409)
        self.assertEqual(self.api(staff, 'POST', '/relations/links', {'assetId': asset, 'ticketId': 9007199254740000}).status, 404)
        self.assertEqual(len(self.relation(staff, asset)['tickets']), 2)
        self.assertEqual(self.api(staff, 'DELETE', f'/relations/links/{asset}/{primary}', {}).status, 409)
        self.assertEqual(int(self.sql('SELECT ticket_id FROM assets WHERE id=$1', [asset])[0]['ticket_id']), primary)
        self.assertEqual(self.api(staff, 'POST', '/auth/logout', {}).status, 200)
        again = self.api_login('tech')
        self.assertEqual({int(t['id']) for t in self.relation(again, asset)['tickets']}, {primary, extra})
        reverse = self.api(again, 'GET', f'/relations/tickets/{extra}/assets').json()
        self.assertTrue(any(int(row['id']) == asset for row in reverse['data']))
        for search in [original['serial'], original['brand'], original['location']]:
            result = self.api(again, 'GET', '/relations/assets?search=' + search.replace(' ', '%20')).json()
            self.assertTrue(any(int(row['id']) == asset for row in result['data']))
        tickets = self.api(again, 'GET', f'/relations/tickets?search={extra}').json()['data']
        self.assertTrue(any(int(row['id']) == extra for row in tickets))
        self.assertEqual(self.api(again, 'DELETE', f'/relations/links/{asset}/{extra}', {}).status, 200)
        self.assertEqual(self.api(again, 'DELETE', f'/relations/links/{asset}/{extra}', {}).status, 404)
        self.assertEqual({int(t['id']) for t in self.relation(again, asset)['tickets']}, {primary})

    def test_d_owner_association_uses_verified_user_ids_and_keeps_text(self):
        staff = self.api_login('tech')
        asset, original = self.asset(staff, owner=self.accounts['requester']['name'])
        self.assertIsNone(self.relation(staff, asset)['ownerUser'])
        owner = self.accounts['requester']['id']
        response = self.api(staff, 'PUT', f'/relations/assets/{asset}/owner', {'userId': owner})
        self.assertEqual(response.status, 200)
        data = self.relation(staff, asset)
        self.assertEqual(int(data['ownerUser']['id']), owner)
        self.assertEqual(data['asset']['owner'], original['owner'])
        inactive = self.sql("INSERT INTO users(name,email,role,active) VALUES($1,$2,'Solicitante',false) RETURNING id",
                            [original['owner'], 'inactive-' + secrets.token_hex(8) + '@example.test'])[0]['id']
        for invalid in [int(inactive), 9007199254740000]:
            self.assertEqual(self.api(staff, 'PUT', f'/relations/assets/{asset}/owner', {'userId': invalid}).status, 400)
        self.assertEqual(int(self.relation(staff, asset)['ownerUser']['id']), owner)
        self.assertEqual(self.api(staff, 'PUT', f'/relations/assets/{asset}/owner', {'userId': None}).status, 200)
        self.assertIsNone(self.relation(staff, asset)['ownerUser'])
        self.assertEqual(self.relation(staff, asset)['asset']['owner'], original['owner'])

    def test_e_all_it_roles_and_requester_restrictions(self):
        staff = self.api_login('admin')
        ticket = self.ticket(staff)
        asset, _ = self.asset(staff, ticket)
        paths = ['/pulse/summary', '/pulse/activity', '/relations/assets', f'/relations/assets/{asset}',
                 '/relations/tickets', '/relations/users', f'/relations/tickets/{ticket}/assets']
        for key in ['tech','tech2','tech3','coordinator','admin']:
            context = self.api_login(key)
            for path in paths:
                self.assertEqual(self.api(context, 'GET', path).status, 200, (key, path))
        for context, expected in [(self.api_login('requester'),403), (self.context(),401)]:
            for path in paths:
                self.assertEqual(self.api(context, 'GET', path).status, expected, path)
            self.assertEqual(self.api(context, 'POST', '/relations/links', {'assetId': asset,'ticketId':ticket}).status, expected)
            self.assertEqual(self.api(context, 'DELETE', f'/relations/links/{asset}/{ticket}', {}).status, expected)
            self.assertEqual(self.api(context, 'PUT', f'/relations/assets/{asset}/owner', {'userId':None}).status, expected)
        employees = self.api(staff, 'GET', '/relations/users').json()['data']
        for user in employees:
            self.assertTrue(set(user) <= {'id','name','role','active'})

    def test_f_migration_preserves_001_to_005_and_repeated_application(self):
        schema = 'v25_compat_' + secrets.token_hex(6)
        initial = '\n'.join((harness.ROOT / 'backend/sql' / name).read_text() for name in
                            ['001_init.sql','002_frontend_compat.sql','003_auth.sql','004_assets_triage_portal.sql','005_ticket_activity.sql'])
        fixture = """
        INSERT INTO users(id,name,email,role) VALUES(1,'Persona histórica','old@example.test','Solicitante');
        INSERT INTO tickets(id,title,requester) VALUES(501,'Principal histórico','Persona histórica'),(502,'Otro histórico','Persona histórica');
        INSERT INTO assets(id,kind,brand,serial,owner_name,location,state,ticket_id)
          VALUES(1,'Notebook','Equipo histórico','V25-LEGACY','Persona histórica','Oficina','Asignado',501);
        INSERT INTO triage_cases(ticket_id,diagnosis) VALUES(501,'Diagnóstico anterior');
        INSERT INTO triage_tests(ticket_id,description,created_by) VALUES(501,'Prueba anterior',1);
        INSERT INTO triage_events(ticket_id,kind,note,created_by) VALUES(501,'Diagnóstico actualizado','Resumen anterior',1);
        INSERT INTO ticket_events(ticket_id,kind,actor_id) VALUES(501,'created',1);
        INSERT INTO ticket_internal_notes(ticket_id,author_id,author_name,content) VALUES(501,1,'Persona histórica','Nota privada anterior');
        """
        snapshot = """SELECT 'preserved' AS marker,jsonb_build_object(
          'users',(SELECT jsonb_agg(u) FROM users u), 'tickets',(SELECT jsonb_agg(t) FROM tickets t),
          'assets',(SELECT jsonb_agg(to_jsonb(a)-'owner_user_id') FROM assets a),
          'cases',(SELECT jsonb_agg(c) FROM triage_cases c), 'tests',(SELECT jsonb_agg(t) FROM triage_tests t),
          'triage',(SELECT jsonb_agg(t) FROM triage_events t), 'events',(SELECT jsonb_agg(e) FROM ticket_events e),
          'notes',(SELECT jsonb_agg(n) FROM ticket_internal_notes n)) AS payload;"""
        migration = (harness.ROOT / 'backend/sql/006_relations_pulse.sql').read_text()
        result = self.sql(f'CREATE SCHEMA {schema}; SET search_path TO {schema};\n' + initial + fixture + snapshot +
                          migration + migration + snapshot +
                          "SELECT 'owner' AS marker,owner_user_id FROM assets WHERE id=1; SELECT 'tables' AS marker,tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE '%pulse%';")
        rows = [row for batch in result for row in batch]
        preserved = [row['payload'] for row in rows if row.get('marker') == 'preserved']
        self.assertEqual(preserved[0], preserved[1])
        self.assertEqual([row['owner_user_id'] for row in rows if row.get('marker') == 'owner'], [None])
        self.assertFalse([row for row in rows if row.get('marker') == 'tables'])

    def test_g_browser_shared_modules_persistence_and_responsive(self):
        staff = self.api_login('tech')
        principal, additional = self.ticket(staff), self.ticket(staff)
        asset, fields = self.asset(staff, principal)
        self.sql("UPDATE tickets SET created_at='1800-01-01T00:00:00Z' WHERE id=$1", [principal])
        context = self.context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        self.login(page, 'tech')
        page.locator('[data-view=pulse]').click()
        expect(page.locator('[data-pulse-status]')).to_have_attribute('data-state', 'ready')
        expect(page.locator('#pulseMetrics article')).to_have_count(6)
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assert_readable(page, '.nx-pulse-workspace')
            mode = page.locator('.nx-pulse-workspace').get_attribute('data-mode')
            self.screenshot(page, f'v25-pulse-{mode}-{width}')
        self.assert_readable(page, '.nx-pulse-workspace')
        page.locator('[data-view=relaciones]').click()
        page.locator('#relSearch').fill(fields['serial'])
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        page.locator('#relAssetSearch button').click()
        expect(page.locator('#relInspector h3')).to_have_text(fields['brand'])
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        page.locator('#relTicketSearch input').fill(str(additional))
        page.locator('#relTicketSearch button').click()
        expect(page.locator(f'#relLinkForm select option[value="{additional}"]')).to_have_count(1)
        page.locator('#relLinkForm select').select_option(str(additional))
        page.locator('#relLinkForm button').click()
        expect(page.locator(f'[data-open-ticket="{additional}"]')).to_be_visible()
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        page.locator('#relUserSearch input').fill(str(self.accounts['requester']['id']))
        page.locator('#relUserSearch button').click()
        expect(page.locator('#relOwnerForm select option')).to_have_count(2)
        page.locator('#relOwnerForm select').select_option(str(self.accounts['requester']['id']))
        page.locator('#relOwnerForm button').click()
        expect(page.locator('#relInspector')).to_contain_text('Cuenta verificada')
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        page.reload()
        expect(page.locator(f'[data-open-ticket="{additional}"]')).to_be_visible()
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.screenshot(page, f'v25-relations-{"api" if page.locator(".rel-surface").get_attribute("data-mode") == "api" else "demo"}-{width}')
        self.assert_readable(page, '.rel-surface')
        page.locator(f'[data-unlink="{additional}"]').click()
        expect(page.locator(f'[data-open-ticket="{additional}"]')).to_have_count(0)
        expect(page.locator(f'[data-open-ticket="{principal}"]')).to_be_visible()
        page.locator(f'[data-open-ticket="{principal}"]').click()
        expect(page.locator('#detailDialog')).to_be_visible()
        expect(page.locator('#detailContent')).to_have_attribute('data-ticket-id', str(principal))
        page.locator('#detailStatus').select_option('En atención')
        page.locator('#saveDetail').click()
        page.wait_for_function('window.NexoBridge.isReady()')
        for _ in range(50):
            if self.api(staff, 'GET', f'/tickets/{principal}').json()['data']['status'] == 'En atención':
                break
            page.wait_for_timeout(100)
        self.assertEqual(self.api(staff, 'GET', f'/tickets/{principal}').json()['data']['status'], 'En atención')
        page.locator('#relOpenAsset').click()
        expect(page.locator('#nxAssetForm')).to_be_visible()
        page.locator('#nxCloseAsset').click()
        self.assertFalse(errors, errors)

    def test_h_demo_isolated_shared_views_and_failed_api_has_no_fallback(self):
        context = self.context()
        page = context.new_page()
        requests = []
        context.on('request', lambda r: requests.append(r.url) if '/api/' in r.url else None)
        page.goto(self.origin + '/login.html')
        page.locator('#email').fill('demo@example.test')
        page.locator('#password').fill('demo')
        page.locator('#loginForm [type=submit]').click()
        page.wait_for_url('**/dashboard.html*')
        page.locator('[data-view=pulse]').click()
        expect(page.locator('[data-pulse-status]')).to_have_attribute('data-state', 'ready')
        expect(page.locator('#pulseMetrics article')).to_have_count(6)
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assert_readable(page, '.nx-pulse-workspace')
            mode = page.locator('.nx-pulse-workspace').get_attribute('data-mode')
            self.screenshot(page, f'v25-pulse-{mode}-{width}')
        self.assert_readable(page, '.nx-pulse-workspace')
        page.locator('[data-view=relaciones]').click()
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        page.locator('#relTicketSearch input').fill('10305')
        page.locator('#relTicketSearch button').click()
        expect(page.locator('#relLinkForm select option')).to_have_count(1)
        page.locator('#relLinkForm button').click()
        expect(page.locator('[data-open-ticket="10305"]')).to_be_visible()
        page.reload()
        expect(page.locator('[data-open-ticket="10305"]')).to_be_visible()
        self.assertFalse(requests, requests)
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.screenshot(page, f'v25-relations-{"api" if page.locator(".rel-surface").get_attribute("data-mode") == "api" else "demo"}-{width}')
        self.login(page, 'tech')
        page.locator('[data-view=relaciones]').click()
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'ready')
        snapshot = page.evaluate('JSON.stringify(localStorage)')
        headers = {'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'}
        page.route('**/api/relations/assets?**', lambda r: r.fulfill(status=503, json={'error':'Fallo controlado'}, headers=headers), times=1)
        page.locator('#relRefresh').click()
        expect(page.locator('[data-rel-status]')).to_have_attribute('data-state', 'error')
        self.assertEqual(page.evaluate('JSON.stringify(localStorage)'), snapshot)


if __name__ == '__main__':
    unittest.main()
