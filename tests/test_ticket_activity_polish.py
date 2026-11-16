"""V2.4.1 visual contracts through the real HTML entry point in Chromium.

API replies are controlled fixtures. PostgreSQL persistence and authorization
are exercised separately by test_ticket_activity.py/test_requester_portal.py.
No real identities, credentials, SQL writes or external icon libraries are used.
"""
import functools
import json
import os
from pathlib import Path
import re
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest

from playwright.sync_api import expect, sync_playwright


DATE = '2026-11-15T15:30:00.123456Z'
USER = dict(id=7, name='Técnica de prueba', email='visual@example.test', role='Técnico', supportLevel=1)
TICKET = dict(id=42, title='Solicitud para revisión visual', description='Conservar la actividad original.',
              requester='Persona de prueba', assignee='Sin asignar', status='Registrado', priority='Media',
              type='Incidente', comments=[], createdAt=DATE)


def event(identifier, source, kind, changes=None, text='Acción documentada', **extra):
    return dict(id=identifier, source=source, kind=kind, ticketId=42,
                actor={'id': 7, 'name': USER['name']}, occurredAt=DATE,
                changes=changes or {}, text=text, **extra)


def activity_fixture():
    return [
        event('event:1', 'ticket', 'created', {'title': {'old': None, 'new': TICKET['title']}}),
        event('event:20', 'ticket', 'updated', {'status': {'old': 'Registrado', 'new': 'En atención'}}),
        event('event:3', 'ticket', 'updated', {'priority': {'old': 'Media', 'new': 'Alta'}}),
        event('event:4', 'ticket', 'updated', {'assignee': {'old': 'Sin asignar', 'new': USER['name']}}),
        event('note:1', 'note', 'internal_note', text='Nota privada de prueba.\nSegunda línea conservada.'),
        event('comment:0', 'comment', 'public_comment', text='Comentario público de prueba.'),
        event('triage:1', 'triage', 'diagnosis', {'diagnosis': {'old': '', 'new': 'Diagnóstico documentado.'}}),
        event('triage:2', 'triage', 'diagnosis', {'testDescription': {'old': None, 'new': 'Prueba de conectividad.'}}),
        event('triage:3', 'triage', 'transfer', {'level': {'old': 1, 'new': 2}}, context={'fromLevel': 1, 'toLevel': 2}),
        event('event:9', 'ticket', 'reopened', {'status': {'old': 'Cerrado', 'new': 'En revisión'}}),
        event('event:10', 'ticket', 'closed', {'status': {'old': 'En atención', 'new': 'Cerrado'}}),
        event('event:11', 'ticket', 'updated', {
            'status': {'old': 'Registrado', 'new': 'En atención'},
            'priority': {'old': 'Media', 'new': 'Alta'},
            'assignee': {'old': 'Sin asignar', 'new': USER['name']},
        }),
    ]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class TicketActivityPolish(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(os.environ.get('NEXODESK_UI_ROOT', Path(__file__).resolve().parents[1]))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw = sync_playwright().start()
        launch = {'headless': True}
        chromium = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        if chromium:
            launch['executable_path'] = chromium
        cls.browser = cls.pw.chromium.launch(**launch)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def open_activity(self, items=None, timezone='UTC', mode='ready'):
        context = self.browser.new_context(viewport={'width': 1440, 'height': 1000},
                                           locale='es-AR', timezone_id=timezone)
        self.addCleanup(context.close)
        context.add_init_script("sessionStorage.setItem('nexodesk-v22-login-mode','api')")
        state = {'items': activity_fixture() if items is None else items, 'mode': mode, 'pending': [], 'requests': []}
        headers = {'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'}

        def fixture(route):
            request = route.request
            state['requests'].append((request.method, request.url))
            self.assertEqual(request.method, 'GET', 'Rendering checks must not write to the API')
            path = request.url.split('/api', 1)[1]
            if path == '/auth/me':
                response = {'user': USER}
            elif path == '/tickets':
                response = {'data': [TICKET]}
            elif path == '/intelligence/status':
                response = {'data': {'provider': 'local', 'externalEnabled': False}}
            elif path == '/tickets/42/intelligence':
                response = {'data': []}
            elif path == '/tickets/42/activity':
                if state['mode'] == 'pending':
                    state['pending'].append(route)
                    return
                if state['mode'] == 'error':
                    route.fulfill(status=503, json={'error': 'No se pudo consultar la actividad de prueba'}, headers=headers)
                    return
                response = {'data': state['items']}
            else:
                self.fail('Unexpected fixture route: ' + path)
            route.fulfill(status=200, json=response, headers=headers)

        context.route('http://127.0.0.1:3001/api/**', fixture)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(self.origin + '/dashboard.html')
        page.wait_for_function('window.NexoBridge?.isReady()')
        page.locator('[data-ticket-id="42"]').click()
        expect(page.locator('#ticketActivity')).to_be_visible()
        if mode == 'ready':
            expect(page.locator('.nx-activity-status')).to_have_attribute('data-state', 'ready')
        self.addCleanup(lambda: self.assertFalse(errors, errors))
        return page, state, headers

    def entry(self, page, identifier):
        return page.locator(f'[data-activity-id="{identifier}"]')

    def test_every_visual_action_has_a_decorative_local_svg_and_keeps_server_order(self):
        items = activity_fixture()
        page, _, _ = self.open_activity(items)
        actual = page.locator('[data-activity-id]').evaluate_all('(els)=>els.map(e=>e.dataset.activityId)')
        self.assertEqual(actual, [item['id'] for item in items], 'Frontend must retain the authoritative server order, including ties')
        expected = ['created', 'status', 'priority', 'assignee', 'internal_note', 'public_comment',
                    'diagnosis', 'test', 'transfer', 'reopened', 'closed', 'updated']
        for item, visual in zip(items, expected):
            with self.subTest(action=visual):
                row = self.entry(page, item['id'])
                svg = row.locator('svg[data-activity-icon]').first
                expect(svg).to_have_attribute('data-activity-icon', visual)
                expect(svg).to_have_attribute('aria-hidden', 'true')
                expect(svg).to_have_attribute('focusable', 'false')
                self.assertGreater(svg.locator('path,line,polyline,rect,circle').count(), 0)
                expect(row).to_contain_text(USER['name'])
        # These four distinct meanings must not collapse to one generic glyph.
        glyphs = [self.entry(page, identifier).locator('svg[data-activity-icon]').first.inner_html()
                  for identifier in ['event:1', 'event:3', 'note:1', 'comment:0']]
        self.assertEqual(len(set(glyphs)), len(glyphs))
        expect(self.entry(page, 'note:1')).to_contain_text('Solo personal IT')
        expect(self.entry(page, 'comment:0')).to_contain_text('Público')

    def test_multi_field_update_is_one_event_with_complete_accessible_before_after(self):
        page, _, _ = self.open_activity()
        row = self.entry(page, 'event:11')
        expect(row).to_have_count(1)
        expect(row.locator('details')).to_have_count(1)
        details = row.locator('details')
        summary = details.locator('summary')
        summary.focus()
        expect(summary).to_be_focused()
        self.assertFalse(details.evaluate('(e)=>e.open'))
        page.keyboard.press('Enter')
        self.assertTrue(details.evaluate('(e)=>e.open'))
        self.assertEqual(row.locator('.nx-change-before').count(), 3)
        self.assertEqual(row.locator('.nx-change-after').count(), 3)
        for label in ['Estado', 'Prioridad', 'Responsable']:
            expect(details).to_contain_text(label)
        for index, value in enumerate(['Registrado', 'Media', 'Sin asignar']):
            expect(row.locator('.nx-change-before').nth(index)).to_contain_text(value)
        for index, value in enumerate(['En atención', 'Alta', USER['name']]):
            expect(row.locator('.nx-change-after').nth(index)).to_contain_text(value)
        directory = os.environ.get('NEXODESK_SCREENSHOTS')
        if directory:
            Path(directory).mkdir(parents=True, exist_ok=True)
            row.scroll_into_view_if_needed()
            page.locator('#detailDialog').screenshot(path=str(Path(directory) / 'timeline-polish-expanded.png'))
        page.keyboard.press('Space')
        self.assertFalse(details.evaluate('(e)=>e.open'))

    def test_untrusted_html_long_values_newlines_and_unknown_metadata_are_preserved(self):
        malicious = '<img src=x onerror="window.__activityXSS=1"><script>window.__activityXSS=2</script>'
        long_value = 'Valor largo: ' + 'equipo-sin-espacios-' * 180
        note = event('note:2', 'note', 'internal_note', text=malicious + '\nSegunda línea\n' + long_value)
        note['actor'] = {'id': 7, 'name': malicious}
        unknown = event('event:99', 'ticket', 'updated', {'description': {'old': None, 'new': ''}}, text='')
        unknown['actor'] = {'id': None, 'name': None}
        unknown['occurredAt'] = None
        unknown['recordedDate'] = '04/05/2020 11:30'
        missing_date = event('event:100', 'ticket', 'updated', text='Información previa sin fecha.')
        missing_date['actor'] = {'id': None, 'name': None}
        missing_date['occurredAt'] = None
        same_title_note = event('note:3', 'note', 'internal_note', text='Nota interna')
        same_title_comment = event('comment:1', 'comment', 'public_comment', text='Comentario público')
        long_change = event('event:98', 'ticket', 'updated', {'description': {'old': malicious, 'new': long_value}})
        page, _, _ = self.open_activity([note, same_title_note, same_title_comment, long_change, unknown, missing_date])
        row = self.entry(page, 'note:2')
        expect(row).to_contain_text(malicious)
        expect(row).to_contain_text(long_value)
        self.assertEqual(row.locator('img,script').count(), 0)
        self.assertIsNone(page.evaluate('window.__activityXSS'))
        self.assertIn('\nSegunda línea\n', row.text_content())
        expect(self.entry(page, 'note:3').locator('.nx-activity-description')).to_have_text('Nota interna')
        expect(self.entry(page, 'comment:1').locator('.nx-activity-description')).to_have_text('Comentario público')
        expect(self.entry(page, 'event:100')).to_contain_text('Fecha no documentada')
        expect(self.entry(page, 'event:100').locator('time')).to_have_count(0)
        changed_row = self.entry(page, 'event:98')
        changed_row.locator('summary').click()
        expect(changed_row.locator('.nx-change-before')).to_contain_text(malicious)
        expect(changed_row.locator('.nx-change-after')).to_contain_text(long_value)
        self.assertEqual(changed_row.locator('img,script').count(), 0)
        expect(self.entry(page, 'event:99')).to_contain_text('Autor no documentado')
        expect(self.entry(page, 'event:99')).to_contain_text('04/05/2020 11:30')
        expect(self.entry(page, 'event:99').locator('time')).to_have_count(0)
        unknown_row = self.entry(page, 'event:99')
        unknown_row.locator('summary').click()
        expect(unknown_row.locator('.nx-change-before')).to_contain_text('Sin dato registrado')
        expect(unknown_row.locator('.nx-change-after')).to_contain_text('Valor vacío')
        for width in [390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 1000})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertEqual(row.locator('img,script').count(), 0)
            expect(row).to_contain_text(long_value)
            expect(changed_row.locator('.nx-change-after')).to_contain_text(long_value)

    def test_dates_use_browser_timezone_without_mutating_recorded_timestamp(self):
        for timezone, local_time in [('UTC', '15:30:00'), ('America/Argentina/Buenos_Aires', '12:30:00')]:
            with self.subTest(timezone=timezone):
                page, _, _ = self.open_activity(timezone=timezone)
                stamp = self.entry(page, 'event:1').locator('time')
                expect(stamp).to_have_attribute('datetime', DATE)
                expect(stamp).to_contain_text(local_time)
                self.assertIn('2026', stamp.inner_text())
                self.assertTrue(stamp.get_attribute('title'), 'Timestamp must explain the display timezone')

    def test_loading_error_empty_and_disabled_feedback_can_recover(self):
        page, state, headers = self.open_activity([], mode='pending')
        expect(page.locator('.nx-activity-status')).to_have_attribute('data-state', 'pending')
        expect(page.locator('#internalNoteForm textarea')).to_be_disabled()
        expect(page.locator('#internalNoteForm button')).to_be_disabled()
        expect(page.locator('#refreshTicketActivity')).to_be_disabled()
        page.wait_for_function('document.querySelector(".nx-activity-list").getAttribute("aria-busy")==="true"')
        self.assertEqual(len(state['pending']), 1)
        state['pending'].pop().fulfill(status=503, json={'error': 'No se pudo consultar la actividad de prueba'}, headers=headers)
        expect(page.locator('.nx-activity-status')).to_have_attribute('data-state', 'error')
        expect(page.locator('.nx-activity-status')).to_contain_text('No se pudo consultar')
        state['mode'] = 'ready'
        page.locator('#refreshTicketActivity').click()
        expect(page.locator('.nx-activity-status')).to_have_attribute('data-state', 'ready')
        expect(page.locator('.nx-activity-empty')).to_be_visible()
        expect(page.locator('.nx-activity-empty')).to_contain_text(re.compile('no hay actividad', re.I))
        expect(page.locator('#refreshTicketActivity')).to_be_focused()
        expect(page.locator('#internalNoteForm textarea')).to_be_enabled()

    def test_responsive_track_markers_contrast_and_interactive_focus(self):
        page, _, _ = self.open_activity()
        page.locator('#ticketActivity details').evaluate_all('(els)=>els.forEach(e=>e.open=true)')
        for width in [390, 768, 1440]:
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 1000})
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                markers = page.locator('[data-activity-id]').evaluate_all("""els=>els.map(e=>{
                  const r=e.querySelector('svg[data-activity-icon]').getBoundingClientRect();
                  return {x:r.x+r.width/2,width:r.width,height:r.height};
                })""")
                self.assertGreater(len(markers), 1)
                self.assertLess(max(m['x'] for m in markers) - min(m['x'] for m in markers), 1.1)
                self.assertTrue(all(m['width'] >= 14 and m['height'] >= 14 for m in markers))
                connectors = page.locator('[data-activity-id]').evaluate_all("""els=>els.slice(0,-1).map(e=>{
                  const s=getComputedStyle(e,'::before');
                  return {content:s.content,width:parseFloat(s.width),height:parseFloat(s.height),display:s.display};
                })""")
                for connector in connectors:
                    self.assertNotIn(connector['content'], ['none', 'normal'])
                    self.assertNotEqual(connector['display'], 'none')
                    self.assertGreaterEqual(connector['width'], 1)
                    self.assertGreater(connector['height'], 0)
                readings = page.locator('#ticketActivity').evaluate("""root=>{
                  const rgb=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
                  const background=e=>{
                    if(!e)return [255,255,255];
                    const c=rgb(getComputedStyle(e).backgroundColor),a=c.length===4?c[3]:1,b=background(e.parentElement);
                    return c.slice(0,3).map((v,i)=>v*a+b[i]*(1-a));
                  };
                  const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
                    .reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
                  return [...root.querySelectorAll('h3,h4,strong,p,summary,dt,dd,small,time,label,button,textarea,.nx-activity-badge,.nx-change-label,.nx-change-value,.nx-change-empty')]
                    .filter(e=>e.getClientRects().length).map(e=>{
                      const s=getComputedStyle(e),b=lum(background(e)),f=lum(rgb(s.color));
                      return {tag:e.tagName,ratio:(Math.max(f,b)+.05)/(Math.min(f,b)+.05)};
                    });
                }""")
                self.assertTrue(readings)
                for reading in readings:
                    self.assertGreaterEqual(reading['ratio'], 4.5, reading)
                refresh = page.locator('#refreshTicketActivity')
                refresh.focus()
                # Real keyboard modality is required for :focus-visible;
                # programmatic focus after a pointer click does not imply it.
                page.keyboard.press('Tab')
                page.keyboard.press('Shift+Tab')
                expect(refresh).to_be_focused()
                outline = refresh.evaluate('(e)=>({style:getComputedStyle(e).outlineStyle,width:parseFloat(getComputedStyle(e).outlineWidth)})')
                self.assertNotEqual(outline['style'], 'none')
                self.assertGreaterEqual(outline['width'], 2)
                refresh.hover()
                self.assertTrue(refresh.is_enabled())
                directory = os.environ.get('NEXODESK_SCREENSHOTS')
                if directory:
                    Path(directory).mkdir(parents=True, exist_ok=True)
                    self.entry(page, 'note:1').scroll_into_view_if_needed()
                    page.locator('#detailDialog').screenshot(path=str(Path(directory) / f'timeline-polish-{width}.png'))


if __name__ == '__main__':
    unittest.main()
