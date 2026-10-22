"""Browser regression for the HTML entry point, shared renderers and dark palette.

API replies are controlled fixtures; PostgreSQL persistence is a separate check.
Run: python3 -m unittest discover -s tests -p 'test_modules_ui.py'
Set NEXODESK_SCREENSHOTS to save desktop/mobile evidence outside the checkout.
"""
import functools
import json
import os
from pathlib import Path
import shutil
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright, expect


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class SharedModulesUI(unittest.TestCase):
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

    def test_both_modes_use_same_structure_and_readable_dark_surfaces(self):
        """Fails if v23 replaces the shared view or a light surface returns."""
        shapes = {}
        screenshot_dir = os.environ.get('NEXODESK_SCREENSHOTS')
        if screenshot_dir:
            Path(screenshot_dir).mkdir(parents=True, exist_ok=True)
        ticket = dict(id=42, title='Revisar acceso a VPN', description='Verificar conectividad y acceso.',
                      requester='Usuario de prueba', assignee='Sin asignar', status='Registrado',
                      priority='Media', type='Incidente', comments=[], createdAt='2026-01-01T12:00:00Z')
        user = dict(id=1, name='Usuario de prueba', email='review@example.test', role='Administrador', supportLevel=None)
        fixtures = {
            '/auth/me': {'user': user}, '/tickets': {'data': [ticket]},
            '/assets': {'data': [dict(id=1, kind='Notebook', brand='Equipo de prueba', serial='REVIEW-001',
                                      owner=user['name'], location='Oficina', state='Asignado', ticketId=42)], 'limit': 200},
            '/portal/my-requests': {'data': [ticket], 'limit': 100},
            '/portal/requests/42': {'data': ticket},
        }
        for mode in ['demo', 'api']:
            with self.subTest(mode=mode):
                context = self.browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-AR')
                context.add_init_script("sessionStorage.setItem('nexodesk-v22-login-mode', " + json.dumps(mode) + ");"
                                        "sessionStorage.setItem('nexodesk-demo-session',JSON.stringify({name:'Usuario de prueba'}));")
                requests = []

                def fixture(route):
                    requests.append(route.request.url)
                    self.assertEqual(route.request.method, 'GET', 'Visual check must not mutate the API')
                    path = route.request.url.split('/api', 1)[1]
                    self.assertIn(path, fixtures)
                    route.fulfill(status=200, json=fixtures[path], headers={
                        'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'})

                context.route('http://127.0.0.1:3001/api/**', fixture)
                page = context.new_page()
                errors, bad_resources = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda response: bad_resources.append(response.url)
                        if response.url.startswith(self.origin) and response.status >= 400 else None)
                page.goto(self.origin + '/dashboard.html')
                page.wait_for_function('window.NexoBridge?.isReady()')
                for view in ['assets', 'portal']:
                    with self.subTest(view=view):
                        page.locator(f'[data-view={view}]').click()
                        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
                        root = page.locator(f'.nx-{view}-workspace')
                        expect(root).to_be_visible()
                        expect(root).to_have_attribute('data-mode', mode)
                        self.assertEqual(root.locator('[class*="nx23-"]').count(), 0)
                        if view == 'assets':
                            self.assertEqual(root.locator('.nx-metrics article').count(), 4)
                        else:
                            self.assertEqual(root.locator('[data-guide]').count(), 4)
                        shape = root.evaluate("""e => [...e.querySelectorAll('h2,h3,form,label,thead th')].map(n =>
                            [n.tagName,n.id,n.tagName==='LABEL' ? n.firstChild.textContent.trim() :
                            n.tagName==='FORM' ? '' : n.textContent.trim()])""")
                        if mode == 'demo':
                            shapes[view] = shape
                        else:
                            self.assertEqual(shape, shapes[view], 'Demo/API structure diverged')
                        readings = root.evaluate("""root => {
                          const rgb=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
                          const background=e=>{
                            if(!e)return [255,255,255];
                            const c=rgb(getComputedStyle(e).backgroundColor),a=c.length===4?c[3]:1,b=background(e.parentElement);
                            return c.slice(0,3).map((v,i)=>v*a+b[i]*(1-a));
                          };
                          const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
                            .reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
                          return [...root.querySelectorAll('.nx-panel,.nx-metrics article,input,select,textarea,thead th,tbody td,label,h2,h3')]
                            .filter(e=>e.getClientRects().length).map(e=>{
                              const s=getComputedStyle(e),b=lum(background(e)),f=lum(rgb(s.color));
                              return {tag:e.tagName,lightness:b,ratio:(Math.max(f,b)+.05)/(Math.min(f,b)+.05)};
                            });
                        }""")
                        self.assertTrue(readings)
                        for reading in readings:
                            self.assertLess(reading['lightness'], .15, f'Light surface: {reading}')
                            self.assertGreaterEqual(reading['ratio'], 4.5, f'Unreadable text: {reading}')
                        for width, size in [(1440, 'desktop'), (390, 'mobile')]:
                            page.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
                            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                            if screenshot_dir:
                                root.screenshot(path=str(Path(screenshot_dir) / f'{view}-{mode}-{size}.png'))
                        page.set_viewport_size({'width': 1440, 'height': 1000})
                self.assertFalse(errors, errors)
                self.assertFalse(bad_resources, bad_resources)
                if mode == 'demo':
                    self.assertFalse(requests, 'Demo unexpectedly used the API')
                context.close()


if __name__ == '__main__':
    unittest.main()
