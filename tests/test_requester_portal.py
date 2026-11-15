"""Real API/PostgreSQL and Chromium regression for NEXODESK V2.3.1.

Requires backend dependencies, Chromium/Playwright and a dedicated database
named nexodesk_test_*. No production database or .env is used. Creates test
records without truncating/deleting existing records. Credentials live only
in process memory and are never printed or written to screenshots.

NEXODESK_TEST_DATABASE_URL=... python -m unittest discover -s tests -p 'test_requester_portal.py' -v
Optional: NEXODESK_SCREENSHOTS=/tmp/nexodesk-v231-screenshots
"""
import functools
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
DATABASE = os.environ.get('NEXODESK_TEST_DATABASE_URL', '')
FIXTURES = r"""
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {hashPassword} from './src/password.ts';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  const {rows}=await pool.query('SELECT current_database() AS name');
  if(!rows[0].name.startsWith('nexodesk_test_'))throw Error('Refusing non-test database');
  for(const file of ['001_init.sql','002_frontend_compat.sql','003_auth.sql','004_assets_triage_portal.sql','005_ticket_activity.sql'])
    await pool.query(await readFile('sql/'+file,'utf8'));
  const run=randomBytes(8).toString('hex'),accounts={};
  for(const [key,role,level] of [['requester','Solicitante',null],['other','Solicitante',null],
    ['tech','Técnico',1],['tech2','Técnico',2],['tech3','Técnico',3],
    ['coordinator','Coordinador',null],['admin','Administrador',null]]){
    const password=randomBytes(24).toString('base64url'),email=key+'-'+run+'@example.test';
    const name=key==='requester'?'Empleado de prueba':key==='other'?'Otra persona':'Personal IT '+key;
    const result=await pool.query(`INSERT INTO users(name,email,role,support_level,password_hash)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,[name,email,role,level,await hashPassword(password)]);
    accounts[key]={id:Number(result.rows[0].id),name,email,password,role};
  }
  const result=await pool.query(`INSERT INTO tickets(title,description,requester,requester_email,source)
    VALUES($1,$2,$3,$4,'Portal') RETURNING id`,['Solicitud para atención '+run,
    'Revisar conexión a la red de la oficina.',accounts.requester.name,accounts.requester.email]);
  console.log(JSON.stringify({accounts,ticketId:Number(result.rows[0].id),run}));
} finally {await pool.end();}
"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


@unittest.skipUnless(DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to an isolated PostgreSQL database')
class RequesterPortal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not urlparse(DATABASE).path.lstrip('/').startswith('nexodesk_test_'):
            raise RuntimeError('Refusing a database without the nexodesk_test_ prefix')
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', 3001))
            except OSError:
                raise RuntimeError('Port 3001 must be free; refusing to test an existing API') from None
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        env = dict(os.environ, DATABASE_URL=DATABASE, FRONTEND_ORIGIN=cls.origin, HOST='127.0.0.1', PORT='3001')
        seed = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', FIXTURES],
                              cwd=ROOT / 'backend', env=env, capture_output=True, text=True)
        if seed.returncode:
            raise RuntimeError('Could not prepare isolated PostgreSQL fixtures; no production database was used')
        cls.fixture = json.loads(seed.stdout)
        cls.accounts = cls.fixture['accounts']
        cls.api_process = subprocess.Popen(['node', 'node_modules/tsx/dist/cli.mjs', 'src/server.ts'],
                                          cwd=ROOT / 'backend', env=env,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_api)
        for _ in range(100):
            try:
                with urlopen('http://127.0.0.1:3001/api/health', timeout=.5) as response:
                    if response.status == 200:
                        break
            except OSError:
                if cls.api_process.poll() is not None:
                    raise RuntimeError('Test API exited; ensure port 3001 is available')
                time.sleep(.1)
        else:
            raise RuntimeError('Test API did not become ready')
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        launch = {'headless': True}
        chromium = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        if chromium:
            launch['executable_path'] = chromium
        cls.browser = cls.pw.chromium.launch(**launch)
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def stop_api(cls):
        cls.api_process.terminate()
        try:
            cls.api_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.api_process.kill()
            cls.api_process.wait(timeout=5)

    def context(self):
        context = self.browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-AR')
        self.addCleanup(context.close)
        return context

    def api(self, context, method, path, body=None):
        args = {'data': body} if body is not None else {}
        return context.request.fetch('http://127.0.0.1:3001/api' + path, method=method, **args)

    def api_login(self, key):
        context = self.context()
        account = self.accounts[key]
        response = self.api(context, 'POST', '/auth/login', {'email': account['email'], 'password': account['password']})
        self.assertEqual(response.status, 200)
        return context

    def login(self, page, key):
        page.goto(self.origin + '/login.html')
        page.locator('#loginMode').select_option('api')
        page.locator('#email').fill(self.accounts[key]['email'])
        page.locator('#password').fill(self.accounts[key]['password'])
        page.locator('#loginForm [type=submit]').click()
        page.wait_for_url('**/dashboard.html*')
        page.wait_for_function('window.NexoBridge?.isReady()')

    def screenshot(self, page, name):
        directory = os.environ.get('NEXODESK_SCREENSHOTS')
        if directory:
            Path(directory).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(directory) / (name + '.png')), full_page=True)

    def assert_readable(self, page, selector='.nx-workspace'):
        readings = page.locator(selector).evaluate("""root=>{
          const rgb=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
          const background=e=>{
            if(!e)return [255,255,255];
            const c=rgb(getComputedStyle(e).backgroundColor),a=c.length===4?c[3]:1,b=background(e.parentElement);
            return c.slice(0,3).map((v,i)=>v*a+b[i]*(1-a));
          };
          const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4})
            .reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
          return [...root.querySelectorAll('h2,h3,label,input,select,textarea,th,td,dt,dd,.nx-panel')]
            .filter(e=>e.getClientRects().length).map(e=>{
              const s=getComputedStyle(e),b=lum(background(e)),f=lum(rgb(s.color));
              return {tag:e.tagName,lightness:b,ratio:(Math.max(f,b)+.05)/(Math.min(f,b)+.05)};
            });
        }""")
        self.assertTrue(readings)
        for reading in readings:
            self.assertLess(reading['lightness'], .15, reading)
            self.assertGreaterEqual(reading['ratio'], 4.5, reading)

    def test_a_server_authorization_and_public_contract(self):
        anonymous = self.context()
        for method, path in [('GET', '/tickets'), ('GET', '/users'), ('GET', '/assets'),
                             ('POST', '/portal/requests'), ('PUT', '/triage/1')]:
            self.assertEqual(self.api(anonymous, method, path, {} if method != 'GET' else None).status, 401)
        owner, other = self.api_login('requester'), self.api_login('other')
        ticket = self.fixture['ticketId']
        denied = [('POST', '/tickets'), ('PATCH', f'/tickets/{ticket}'), ('GET', '/users'),
                  ('POST', '/users'), ('PATCH', f"/users/{self.accounts['requester']['id']}"),
                  ('POST', f"/users/{self.accounts['admin']['id']}/reset-password"),
                  ('GET', '/assets'), ('POST', '/assets'), ('PATCH', '/assets/1'),
                  ('GET', f'/triage/{ticket}'), ('PUT', f'/triage/{ticket}'),
                  ('POST', f'/triage/{ticket}/transfer'), ('GET', '/triage/summary'),
                  ('GET', '/triage/assignees')]
        for method, path in denied:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.api(owner, method, path, {} if method != 'GET' else None).status, 403)
        for path in [f'/tickets/{ticket}', f'/portal/requests/{ticket}', '/tickets/9007199254740990']:
            self.assertEqual(self.api(other, 'GET', path).status, 403)
        self.assertEqual(self.api(other, 'POST', f'/tickets/{ticket}/comments', {'text': 'No autorizado'}).status, 403)
        self.assertEqual(self.api(other, 'GET', '/tickets').json()['data'], [])
        self.assertEqual(self.api(other, 'GET', '/portal/my-requests').json()['data'], [])
        form = {'type': 'Incidente', 'title': 'Solicitud autorizada', 'description': 'Descripción de la solicitud.'}
        before = self.api(owner, 'GET', '/portal/my-requests').json()['data']
        for field, value in {'requester': 'Otra persona', 'requesterEmail': self.accounts['other']['email'],
                             'priority': 'Crítica', 'status': 'Cerrado', 'assignee': self.accounts['tech']['name'],
                             'source': 'Dashboard', 'comments': []}.items():
            with self.subTest(tampered=field):
                self.assertEqual(self.api(owner, 'POST', '/portal/requests', dict(form, **{field: value})).status, 403)
        self.assertEqual(len(self.api(owner, 'GET', '/portal/my-requests').json()['data']), len(before))
        created = self.api(owner, 'POST', '/portal/requests', form)
        self.assertEqual(created.status, 201)
        self.assertEqual((created.json()['data']['priority'], created.json()['data']['status']), ('Media', 'Registrado'))
        staff = self.api_login('tech')
        result = self.api(staff, 'POST', f'/tickets/{ticket}/comments', {'text': 'Comentario público del equipo IT.'})
        self.assertEqual(result.status, 201)
        allowed = {'id', 'title', 'description', 'type', 'priority', 'status', 'createdAt', 'updatedAt', 'comments'}
        for path in [f'/tickets/{ticket}', f'/portal/requests/{ticket}']:
            response = self.api(owner, 'GET', path)
            self.assertEqual(response.status, 200)
            self.assertEqual(set(response.json()['data']), allowed)
            self.assertEqual(response.json()['data']['comments'][-1]['text'], 'Comentario público del equipo IT.')
        comment = self.api(owner, 'POST', f'/tickets/{ticket}/comments', {'text': 'Respuesta del empleado.'})
        self.assertEqual(comment.status, 201)
        self.assertEqual(set(comment.json()['data']), allowed)
        self.assertEqual(comment.json()['data']['comments'][-1]['author'], self.accounts['requester']['name'])

    def test_b_requester_login_creation_persistence_navigation_and_mobile(self):
        context = self.context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # A stale Demo preference must not select local data for a real employee.
        page.goto(self.origin + '/login.html')
        sentinel = '[{"id":9999,"title":"Solo demo"}]'
        page.evaluate('(value)=>{localStorage.setItem("nexodesk-demo-tickets-v1",value);localStorage.setItem("nexodesk-v21-mode","demo")}', sentinel)
        self.login(page, 'requester')
        expect(page.locator('body')).to_have_class('nx-requester')
        self.assertTrue(page.url.endswith('#portal'))
        expect(page.locator('#staffNav')).to_be_hidden()
        expect(page.locator('#requesterNav')).to_be_visible()
        self.assertEqual(page.locator('#requesterNav button:visible').count(), 5)
        self.assertEqual(page.locator('#nxPortalForm [name]').evaluate_all('(els)=>els.map(e=>e.name)'),
                         ['type', 'title', 'description'])
        expect(page.locator('.nx-sync-controls')).to_be_hidden()
        expect(page.locator('[data-go-view=tickets]')).to_have_count(0)
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
        self.assert_readable(page)
        self.screenshot(page, 'portal-solicitante-desktop')
        for target in ['dashboard', 'tickets', 'usuarios', 'assets', 'triage', 'reportes', 'configuracion', 'procesos']:
            page.evaluate('(view)=>window.dispatchEvent(new CustomEvent("nexodesk:open-view",{detail:view}))', target)
            expect(page.locator('#pageTitle')).to_have_text('Mi Portal')
            self.assertTrue(page.url.endswith('#portal'))
        page.goto(self.origin + '/dashboard.html?view=assets#triage')
        expect(page.locator('#pageTitle')).to_have_text('Mi Portal')
        self.assertTrue(page.url.endswith('#portal'))
        page.locator('#newTicketButton').click()
        expect(page.locator('#ticketDialog')).not_to_be_visible()
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
        title = 'Acceso de empleado ' + secrets.token_hex(5)
        page.locator('#nxPortalForm [name=type]').select_option('Requerimiento')
        page.locator('#nxPortalForm [name=title]').fill(title)
        page.locator('#nxPortalForm [name=description]').fill('Necesito acceso a la aplicación de trabajo.')
        page.locator('#nxPortalForm [type=submit]').click()
        expect(page.locator('#portalStatus')).to_contain_text('registrada correctamente')
        expect(page.locator('#nxPortalRequests')).to_contain_text(title)
        self.assertEqual(page.evaluate('localStorage.getItem("nexodesk-demo-tickets-v1")'), sentinel)
        page.reload()
        expect(page.locator('#nxPortalRequests')).to_contain_text(title)
        page.locator('#nxPortalRequests button').filter(has_text=title).click()
        expect(page.locator('#nxLookupResult')).to_contain_text('Requerimiento')
        expect(page.locator('#nxLookupResult')).to_contain_text('Registrado')
        page.locator('#nxPortalCommentForm [name=comment]').fill('Información adicional del empleado.')
        page.locator('#nxPortalCommentForm button').click()
        expect(page.locator('.nx-public-comments')).to_contain_text('Información adicional del empleado.')
        page.locator('[data-view=cuenta]').click()
        expect(page.locator('.nx-account-details')).to_contain_text(self.accounts['requester']['email'])
        expect(page.locator('#nxPasswordForm')).to_be_visible()
        self.assert_readable(page)
        self.screenshot(page, 'mi-cuenta-solicitante')
        page.locator('[data-portal-section=requests]').click()
        for width in [390, 760, 1440]:
            page.set_viewport_size({'width': width, 'height': 844})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            if width == 390:
                self.screenshot(page, 'portal-solicitante-mobile')
        page.locator('#logoutButton').click()
        page.wait_for_url('**/login.html')
        self.login(page, 'requester')
        expect(page.locator('#nxPortalRequests')).to_contain_text(title)
        # Browser history and reloads must also retain the authorized destination.
        page.evaluate('location.hash="reportes"')
        expect(page.locator('#pageTitle')).to_have_text('Mi Portal')
        page.reload()
        expect(page.locator('#pageTitle')).to_have_text('Mi Portal')
        self.assertFalse(errors, errors)

    def test_c_staff_roles_keep_operational_functions(self):
        ticket = self.fixture['ticketId']
        context = self.context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        self.login(page, 'tech')
        expect(page.locator('#boardSection')).to_be_visible()
        expect(page.locator('#requesterNav')).to_be_hidden()
        page.locator(f'[data-ticket-id="{ticket}"]').click()
        page.locator('#detailStatus').select_option('En atención')
        page.locator('#saveDetail').click()
        page.wait_for_function('document.querySelector("#nxSyncStatus").textContent.includes("Todos los cambios confirmados")')
        self.assertEqual(self.api(context, 'GET', f'/tickets/{ticket}').json()['data']['status'], 'En atención')
        asset = {'kind': 'Notebook', 'brand': 'Equipo de prueba', 'serial': 'V231-' + secrets.token_hex(8),
                 'owner': self.accounts['requester']['name'], 'location': 'Oficina', 'state': 'Asignado', 'ticketId': ticket}
        result = self.api(context, 'POST', '/assets', asset)
        self.assertEqual(result.status, 201)
        asset_id = result.json()['data']['id']
        asset['location'] = 'Soporte'
        self.assertEqual(self.api(context, 'PATCH', f'/assets/{asset_id}', asset).status, 200)
        classification = {'category': 'Redes / VPN', 'impact': 'Medio', 'urgency': 'Alta',
                          'diagnosis': 'Conectividad comprobada.', 'newTest': 'Se probó conexión de red.', 'applyPriority': True}
        self.assertEqual(self.api(context, 'PUT', f'/triage/{ticket}', classification).status, 200)
        for level, person in [(2, 'tech2'), (3, 'tech3')]:
            transfer = {'toLevel': level, 'reason': 'Requiere revisión especializada.',
                        'pending': 'Continuar diagnóstico de conectividad.', 'assigneeUserId': self.accounts[person]['id']}
            self.assertEqual(self.api(context, 'POST', f'/triage/{ticket}/transfer', transfer).status, 200)
        triage = self.api(context, 'GET', f'/triage/{ticket}').json()['data']
        self.assertEqual(triage['level'], 3)
        self.assertTrue(triage['tests'])
        self.assertGreaterEqual(len(triage['history']), 3)
        owner = self.api_login('requester')
        self.assertEqual(self.api(owner, 'GET', f'/portal/requests/{ticket}').json()['data']['status'], 'En atención')
        self.screenshot(page, 'tecnico-l1-operativo')
        for key in ['tech2', 'tech3', 'coordinator', 'admin']:
            self.login(page, key)
            expect(page.locator('#boardSection')).to_be_visible()
            expect(page.locator('[data-view=assets]')).to_be_visible()
            expect(page.locator('[data-view=triage]')).to_be_visible()
            self.assertEqual(self.api(context, 'GET', '/users').status, 403 if key in ['tech2','tech3'] else 200)
            if key == 'coordinator':
                self.assertEqual(self.api(context, 'POST', '/users', {}).status, 403)
        page.locator('[data-view=usuarios]').click()
        expect(page.locator('#nxRealUserForm')).to_be_visible()
        self.assertEqual(self.api(context, 'GET', '/users').status, 200)
        account = {'name': 'Cuenta creada por administrador', 'email': 'admin-test-' + secrets.token_hex(8) + '@example.test',
                   'password': secrets.token_urlsafe(24), 'role': 'Solicitante', 'supportLevel': None}
        created = self.api(context, 'POST', '/users', account)
        self.assertEqual(created.status, 201)
        self.assertEqual(self.api(context, 'PATCH', '/users/' + str(created.json()['user']['id']), {'active': False}).status, 200)
        self.assertFalse(errors, errors)

    def test_d_demo_stays_local_and_public_portal_does_not_use_api(self):
        context = self.context()
        requests = []
        context.on('request', lambda request: requests.append(request.url) if '/api/' in request.url else None)
        page = context.new_page()
        page.goto(self.origin + '/login.html')
        page.locator('#email').fill('demo@example.test')
        page.locator('#password').fill('demo')
        page.locator('#loginForm [type=submit]').click()
        page.wait_for_url('**/dashboard.html*')
        expect(page.locator('#boardSection')).to_be_visible()
        page.locator('[data-view=portal]').click()
        page.locator('#nxPortalForm [name=requester]').fill('Usuario demo')
        page.locator('#nxPortalForm [name=title]').fill('Solicitud solo local')
        page.locator('#nxPortalForm [name=description]').fill('Registro de demostración.')
        page.locator('#nxPortalForm [type=submit]').click()
        expect(page.locator('#nxPortalRequests')).to_contain_text('Solicitud solo local')
        page.reload()
        expect(page.locator('#nxPortalRequests')).to_contain_text('Solicitud solo local')
        page.goto(self.origin + '/portal.html')
        expect(page.locator('.nx-portal-workspace')).to_have_attribute('data-mode', 'demo')
        self.assertFalse(requests, requests)

    def test_e_expired_session_returns_to_real_login(self):
        context = self.context()
        page = context.new_page()
        self.login(page, 'requester')
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
        self.assertEqual(self.api(context, 'POST', '/auth/logout', {}).status, 200)
        page.locator('#nxPortalRefresh').click()
        page.wait_for_url('**/login.html?expired=1')
        expect(page.locator('#loginMode')).to_have_value('api')

    def test_f_failed_operations_keep_data_and_require_confirmation_before_retry(self):
        context = self.context()
        page = context.new_page()
        self.login(page, 'requester')
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
        headers = {'Access-Control-Allow-Origin': self.origin, 'Access-Control-Allow-Credentials': 'true'}
        def unavailable(route):
            route.fulfill(status=503, json={'error': 'Servicio temporalmente no disponible'}, headers=headers)
        snapshot = page.evaluate('JSON.stringify(localStorage)')
        page.route('**/api/portal/my-requests', unavailable, times=1)
        page.locator('#nxPortalRefresh').click()
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'error')
        expect(page.locator('#nxPortalForm button')).to_be_disabled()
        page.locator('#nxPortalRefresh').click()
        expect(page.locator('.nx-module-status')).to_have_attribute('data-state', 'ready')
        page.locator('#nxPortalForm [name=title]').fill('Resultado sin confirmar')
        page.locator('#nxPortalForm [name=description]').fill('No debe crearse una copia local.')
        page.route('**/api/portal/requests', unavailable, times=1)
        page.locator('#nxPortalForm [type=submit]').click()
        expect(page.locator('#portalStatus')).to_contain_text('No se pudo confirmar')
        expect(page.locator('#nxPortalForm button')).to_be_disabled()
        self.assertEqual(page.evaluate('JSON.stringify(localStorage)'), snapshot)
        page.locator('#nxPortalRefresh').click()
        expect(page.locator('#nxPortalForm button')).to_be_enabled()
        self.assertEqual(page.locator('#nxPortalForm [name=title]').input_value(), 'Resultado sin confirmar')
        page.locator(f'[data-portal-id="{self.fixture["ticketId"]}"]').click()
        expect(page.locator('#nxPortalCommentForm')).to_be_visible()
        page.route('**/api/tickets/*/comments', unavailable, times=1)
        page.locator('#nxPortalCommentForm [name=comment]').fill('Comentario sin confirmar.')
        page.locator('#nxPortalCommentForm button').click()
        expect(page.locator('#nxPortalCommentForm')).to_contain_text('Consultá nuevamente')
        expect(page.locator('#nxPortalCommentForm button')).to_be_disabled()
        page.locator('#nxLookup').click()
        expect(page.locator('#nxPortalCommentForm button')).to_be_enabled()


if __name__ == '__main__':
    unittest.main()
