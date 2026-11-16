"""Chromium acceptance flows for the integrated V2.6–V2.9 block.

Uses the real API and an explicitly isolated nexodesk_test_* PostgreSQL database.
No paid AI provider is needed. Screenshots are opt-in and remain outside Git.
"""
import json
import os
import secrets
import subprocess
import unittest
from pathlib import Path
from datetime import datetime, timezone

from playwright.sync_api import expect

import test_requester_portal as harness
from test_ticket_activity import SQL_RUNNER


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class IntegratedBrowser(unittest.TestCase):
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
        self.assertEqual(result.returncode, 0, 'Isolated SQL verification failed: ' + result.stderr)
        return json.loads(result.stdout)

    def ticket(self, context, title=None):
        response = self.api(context, 'POST', '/tickets', {
            'title': title or 'VPN sin conexión ' + secrets.token_hex(6),
            'description': 'La VPN no conecta. Revisar conectividad de red y configuración del cliente.',
            'type': 'Incidente', 'requester': self.accounts['requester']['name'],
            'requesterEmail': self.accounts['requester']['email'],
        })
        self.assertEqual(response.status, 201)
        return int(response.json()['data']['id'])

    def page(self, context):
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        self.addCleanup(lambda: self.assertFalse(errors, errors))
        return page

    def responsive(self, page, selector, name):
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), width)
            self.assert_readable(page, selector)
            self.screenshot(page, f'v29-{name}-{width}')

    def test_intelligence_local_suggestion_decision_persists_without_ticket_mutation(self):
        staff = self.api_login('tech')
        ticket = self.ticket(staff)
        before = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        page = self.page(self.context())
        self.login(page, 'tech')
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        status = page.locator('[data-intelligence-status]')
        expect(status).to_have_attribute('data-state', 'ready')
        expect(status).to_contain_text('motor local')
        expect(page.locator('[data-intelligence-id]')).to_have_count(0)
        page.locator('[data-intelligence-analyze]').focus()
        expect(page.locator('[data-intelligence-analyze]')).to_be_focused()
        page.keyboard.press('Enter')
        expect(page.locator('[data-intelligence-id]')).to_have_count(1)
        expect(page.locator('[data-intelligence-id]')).to_contain_text('Sugerencia del motor local')
        summary = page.locator('[data-intelligence-id] summary')
        summary.focus()
        self.assertEqual(summary.evaluate('(element)=>getComputedStyle(element).outlineStyle'), 'solid')
        page.keyboard.press('Enter')
        self.assertTrue(page.locator('[data-intelligence-id] details').evaluate('(element)=>element.open'))
        page.keyboard.press('Enter')
        self.assertFalse(page.locator('[data-intelligence-id] details').evaluate('(element)=>element.open'))
        page.locator('[data-intelligence-decision=accepted]').click()
        expect(page.locator('[data-intelligence-id]')).to_contain_text('Aceptada por personal IT')
        self.assertEqual(self.api(staff, 'GET', f'/tickets/{ticket}').json()['data'], before)
        page.reload()
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        expect(page.locator('[data-intelligence-id]')).to_contain_text('Aceptada por personal IT')
        page.locator('#closeDetail').click()
        page.locator('.nav-item[data-view=intelligence]').click()
        expect(page.locator('.intel-module [data-intelligence-status]')).to_have_attribute('data-state', 'ready')
        self.responsive(page, '.intel-module', 'intelligence-api')

    def test_requester_stays_in_portal_and_cannot_navigate_internal_modules(self):
        context = self.context()
        page = self.page(context)
        self.login(page, 'requester')
        for view in ['intelligence', 'sla', 'inventory', 'reportes']:
            with self.subTest(view=view):
                expect(page.locator(f'#staffNav [data-view="{view}"]')).to_be_hidden()
                page.goto(self.origin + '/dashboard.html#' + view)
                page.wait_for_function('window.NexoBridge?.isReady()')
                expect(page).to_have_url(self.origin + '/dashboard.html#portal')
                expect(page.locator('#requesterNav')).to_be_visible()
                expect(page.locator('#internalNoteForm')).to_have_count(0)

    def test_inventory_csv_preview_commit_update_history_and_export(self):
        staff = self.api_login('admin')
        page = self.page(self.context())
        page.on('dialog', lambda dialog: dialog.accept())
        self.login(page, 'admin')
        page.locator('.nav-item[data-view=inventory]').click()
        expect(page.locator('#inventoryFeedback')).to_have_attribute('data-state', 'ready')
        serial = 'BROWSER-' + secrets.token_hex(8)
        header = 'kind,brand,serial,owner,location,state'
        row = f'Notebook,Equipo de aceptación,{serial},Responsable textual,Oficina,Disponible'
        page.locator('#inventoryCsv').fill(header + '\n' + row + '\nNotebook,Equipo inválido,,Persona,,Disponible')
        page.locator('#inventoryPreview').click()
        expect(page.locator('#inventoryPreviewRows tr')).to_have_count(2)
        expect(page.locator('#inventoryCommit')).to_be_disabled()
        csv = header + '\n' + row
        page.locator('#inventoryFile').set_input_files({
            'name': 'inventario-aceptacion.csv', 'mimeType': 'text/csv', 'buffer': csv.encode('utf-8'),
        })
        expect(page.locator('#inventoryCsv')).to_have_value(csv)
        page.locator('#inventoryPreview').click()
        expect(page.locator('#inventoryCommit')).to_be_enabled()
        expect(page.locator('#inventoryPreviewRows')).to_contain_text(serial)
        page.locator('#inventoryCommit').click()
        expect(page.locator('#inventoryFeedback')).to_have_attribute('data-state', 'ready')
        result = self.api(staff, 'GET', '/relations/assets?search=' + serial).json()['data']
        self.assertEqual(len(result), 1)
        asset = result[0]['id']
        self.assertEqual(result[0]['location'], 'Oficina')
        page.reload()
        expect(page.locator(f'[data-inventory-history="{asset}"]')).to_be_visible()
        page.locator(f'[data-inventory-history="{asset}"]').click()
        expect(page.locator('#inventoryHistory')).to_contain_text('Oficina')
        page.locator('#inventoryCsv').fill(header + '\n' + row.replace('Oficina', 'Laboratorio'))
        page.locator('#inventoryUpdates').check()
        page.locator('#inventoryPreview').click()
        expect(page.locator('#inventoryCommit')).to_be_enabled()
        page.locator('#inventoryCommit').click()
        expect(page.locator('#inventoryFeedback')).to_have_attribute('data-state', 'ready')
        result = self.api(staff, 'GET', '/relations/assets?search=' + serial).json()['data']
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['location'], 'Laboratorio')
        page.locator(f'[data-inventory-history="{asset}"]').click()
        expect(page.locator('#inventoryHistory')).to_contain_text('Laboratorio')
        with page.expect_download() as downloaded:
            page.locator('#inventoryExport').click()
        content = Path(downloaded.value.path()).read_text(encoding='utf-8-sig')
        self.assertIn(serial, content)
        self.assertIn('Laboratorio', content)
        self.responsive(page, '.nx-inventory', 'inventory-api')

    def test_sla_alert_check_is_idempotent_and_acknowledgement_persists(self):
        staff = self.api_login('tech')
        ticket = self.ticket(staff)
        self.sql("""UPDATE ticket_sla SET response_due_at=clock_timestamp()-interval '2 minutes',
                 resolution_due_at=clock_timestamp()-interval '1 minute' WHERE ticket_id=$1""", [ticket])
        page = self.page(self.context())
        self.login(page, 'tech')
        page.locator('.nav-item[data-view=sla]').click()
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state', 'ready')
        page.locator('#slaCheck').click()
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state', 'ready')
        alerts = self.sql('SELECT id,kind FROM sla_alerts WHERE ticket_id=$1 ORDER BY id', [ticket])
        self.assertIn('response_breach', [alert['kind'] for alert in alerts])
        self.assertIn('resolution_breach', [alert['kind'] for alert in alerts])
        alert_id = alerts[0]['id']
        page.locator(f'[data-sla-ack="{alert_id}"]').click()
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state', 'ready')
        acknowledged = self.sql('SELECT acknowledged_by,acknowledged_at FROM sla_alerts WHERE id=$1', [alert_id])[0]
        self.assertEqual(int(acknowledged['acknowledged_by']), self.accounts['tech']['id'])
        self.assertIsNotNone(acknowledged['acknowledged_at'])
        page.reload()
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state', 'ready')
        expect(page.locator(f'[data-sla-ack="{alert_id}"]')).to_have_count(0)
        page.locator('#slaCheck').click()
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state', 'ready')
        self.assertEqual(self.sql('SELECT id,kind FROM sla_alerts WHERE ticket_id=$1 ORDER BY id', [ticket]), alerts)
        after = self.api(staff, 'GET', f'/tickets/{ticket}').json()['data']
        self.assertEqual(after['priority'], 'Media')
        self.assertEqual(after['assignee'], 'Sin asignar')
        self.responsive(page, '.nx-sla-workspace', 'sla-api')

    def test_reports_filters_export_and_failed_api_recover_without_demo_fallback(self):
        staff = self.api_login('admin')
        marker = 'Responsable ' + secrets.token_hex(8)
        first, second = self.ticket(staff), self.ticket(staff)
        for ticket in [first, second]:
            self.assertEqual(self.api(staff, 'PATCH', f'/tickets/{ticket}', {
                'assignee': marker, 'priority': 'Alta',
                'status': 'Cerrado' if ticket == first else 'En atención',
            }).status, 200)
        page = self.page(self.context())
        self.login(page, 'admin')
        page.locator('.nav-item[data-view=reportes]').click()
        status = page.locator('[data-reports-status]')
        expect(status).to_have_attribute('data-state', 'ready')
        today = datetime.now(timezone.utc).date().isoformat()
        page.locator('#reportsFilters [name=from]').fill(today)
        page.locator('#reportsFilters [name=to]').fill(today)
        page.locator('#reportsFilters [name=assignee]').fill(marker)
        page.locator('#reportsFilters [name=category]').fill('Sin clasificar')
        page.locator('#reportsFilters [name=priority]').select_option('Alta')
        page.locator('#reportsFilters button').click()
        expect(status).to_have_attribute('data-state', 'ready')
        expect(page.locator('#reportsMetrics article')).to_have_count(7)
        expect(page.locator('#reportsMetrics article').nth(0).locator('strong')).to_have_text('2')
        expect(page.locator('#reportsMetrics article').nth(1).locator('strong')).to_have_text('1')
        expect(page.locator('#reportsWorkload')).to_contain_text(marker)
        with page.expect_download() as downloaded:
            page.locator('#reportsExport').click()
        content = Path(downloaded.value.path()).read_text(encoding='utf-8-sig')
        self.assertIn(marker, content)
        self.assertIn('Alta', content)
        self.assertNotIn(self.accounts['requester']['email'], content)
        snapshot = page.evaluate('JSON.stringify(localStorage)')
        headers = {'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'}
        page.route('**/api/reports/summary?**', lambda route: route.fulfill(
            status=503, json={'error': 'Fallo controlado de reportes'}, headers=headers), times=1)
        page.locator('#reportsRefresh').click()
        expect(status).to_have_attribute('data-state', 'error')
        expect(page.locator('#reportsExport')).to_be_disabled()
        self.assertEqual(page.evaluate('JSON.stringify(localStorage)'), snapshot)
        page.locator('#reportsRefresh').click()
        expect(status).to_have_attribute('data-state', 'ready')
        expect(page.locator('#reportsMetrics article').nth(0).locator('strong')).to_have_text('2')
        delayed = []
        page.route('**/api/reports/summary?**', lambda route: delayed.append(route), times=1)
        page.locator('#reportsRefresh').click()
        expect(status).to_have_attribute('data-state', 'pending')
        page.locator('.nav-item[data-view=pulse]').click()
        page.locator('.nav-item[data-view=reportes]').click()
        expect(page.locator('[data-reports-status]')).to_have_attribute('data-state', 'pending')
        self.assertEqual(len(delayed), 1)
        delayed[0].fulfill(response=delayed[0].fetch())
        expect(page.locator('[data-reports-status]')).to_have_attribute('data-state', 'ready')
        expect(page.locator('#reportsMetrics article').nth(0).locator('strong')).to_have_text('2')
        self.responsive(page, '.nx-reports-workspace', 'reports-api')
        page.emulate_media(media='print')
        expect(page.locator('#reportsExport')).to_be_hidden()
        self.assertEqual(page.locator('.nx-reports-workspace').evaluate(
            '(element)=>getComputedStyle(element).backgroundColor'), 'rgb(255, 255, 255)')
        self.assertEqual(page.locator('.nx-reports-workspace h2').evaluate(
            '(element)=>getComputedStyle(element).color'), 'rgb(16, 37, 54)')
        self.assertTrue(page.pdf(format='A4', print_background=False).startswith(b'%PDF-'))
        page.emulate_media(media='screen')

    def test_demo_uses_shared_workspaces_without_api_or_cross_source_writes(self):
        context = self.context()
        page = self.page(context)
        page.on('dialog', lambda dialog: dialog.accept())
        requests = []
        context.on('request', lambda request: requests.append(request.url) if '/api/' in request.url else None)
        page.goto(self.origin + '/login.html')
        page.locator('#email').fill('demo@example.test')
        page.locator('#password').fill('demo')
        page.locator('#loginForm [type=submit]').click()
        page.wait_for_url('**/dashboard.html*')
        shapes = {}
        views = [
            ('intelligence', '.intel-module', '.intel-module [data-intelligence-status]'),
            ('sla', '.nx-sla-workspace', '[data-sla-status]'),
            ('inventory', '.nx-inventory', '#inventoryFeedback'),
            ('reportes', '.nx-reports-workspace', '[data-reports-status]'),
        ]
        for view, surface, status in views:
            page.locator(f'.nav-item[data-view="{view}"]').click()
            expect(page.locator(status)).to_have_attribute('data-state', 'ready')
            shapes[view] = page.locator(surface).locator('h2,h3').all_text_contents()
            self.responsive(page, surface, view + '-demo')
        page.locator('.nav-item[data-view=intelligence]').click()
        expect(page.locator('.intel-module [data-intelligence-status]')).to_have_attribute('data-state', 'ready')
        page.locator('.intel-module [data-intelligence-analyze]').click()
        page.locator('.intel-module [data-intelligence-decision=discarded]').click()
        expect(page.locator('.intel-module [data-intelligence-id]')).to_contain_text('Descartada por personal IT')
        page.reload()
        expect(page.locator('.intel-module [data-intelligence-id]')).to_contain_text('Descartada por personal IT')
        page.locator('.nav-item[data-view=inventory]').click()
        expect(page.locator('#inventoryFeedback')).to_have_attribute('data-state', 'ready')
        serial = 'DEMO-BROWSER-' + secrets.token_hex(6)
        page.locator('#inventoryCsv').fill(
            'kind,brand,serial,owner,location,state\n'
            f'Notebook,Equipo Demo,{serial},Responsable Demo,Oficina Demo,Disponible')
        page.locator('#inventoryPreview').click()
        expect(page.locator('#inventoryCommit')).to_be_enabled()
        page.locator('#inventoryCommit').click()
        expect(page.locator('#inventoryFeedback')).to_have_attribute('data-state', 'ready')
        page.reload()
        expect(page.locator('#inventoryRows')).to_contain_text(serial)
        self.assertFalse(requests, requests)
        saved = page.evaluate("""()=>Object.fromEntries(Object.keys(localStorage)
          .filter(key=>key.startsWith('nexodesk-demo-')).map(key=>[key,localStorage.getItem(key)]))""")
        self.login(page, 'admin')
        for view, surface, status in views:
            page.locator(f'.nav-item[data-view="{view}"]').click()
            expect(page.locator(status)).to_have_attribute('data-state', 'ready')
            self.assertEqual(page.locator(surface).locator('h2,h3').all_text_contents(), shapes[view])
        self.assertEqual(page.evaluate("""()=>Object.fromEntries(Object.keys(localStorage)
          .filter(key=>key.startsWith('nexodesk-demo-')).map(key=>[key,localStorage.getItem(key)]))"""), saved)


if __name__ == '__main__':
    unittest.main()
