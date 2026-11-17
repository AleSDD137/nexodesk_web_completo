"""Corrective V2.9.1 API and real Chromium regression on isolated PostgreSQL."""
import unittest
import secrets
import test_requester_portal as h
from playwright.sync_api import expect

@unittest.skipUnless(h.DATABASE,'Set isolated NEXODESK_TEST_DATABASE_URL')
class Corrections(unittest.TestCase):
    setUpClass=classmethod(h.RequesterPortal.setUpClass.__func__)
    stop_api=classmethod(h.RequesterPortal.stop_api.__func__)
    context=h.RequesterPortal.context
    api=h.RequesterPortal.api
    api_login=h.RequesterPortal.api_login
    login=h.RequesterPortal.login
    screenshot=h.RequesterPortal.screenshot

    def test_search_roles_pagination_and_read_only_browser(self):
        admin=self.api_login('admin');owner=self.api_login('requester');marker='SEARCH'+secrets.token_hex(5)
        for _ in range(12):
            self.assertEqual(self.api(owner,'POST','/portal/requests',{'title':marker,'description':'Contexto de prueba','type':'Incidente'}).status,201)
        r=self.api(admin,'GET','/search?q='+marker+'&limit=5&offset=5').json()
        self.assertEqual((r['total'],len(r['data'])),(12,5))
        self.assertEqual(self.api(self.context(),'GET','/search?q=x').status,401)
        self.assertEqual(self.api(owner,'GET','/search?q=x&type=users').status,403)
        other=self.api_login('other');self.assertEqual(self.api(other,'GET','/search?q='+marker).json()['total'],0)
        self.assertEqual(self.api(self.api_login('tech'),'GET','/search?q=x&type=users').status,403)
        page=self.context().new_page();self.login(page,'admin');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.locator('[data-view=sla]').click();expect(page.locator('[data-sla-status]')).to_have_attribute('data-state','ready')
        page.evaluate('window.beforePanel=document.querySelector("#alternateView").firstElementChild;window.beforeScroll=scrollY')
        requests=[];page.on('request',lambda r:requests.append((r.method,r.url)) if '/api/' in r.url else None)
        field=page.locator('#searchInput');field.press_sequentially(marker,delay=15)
        expect(page.locator('#globalSearchResults [data-search-type=tickets]')).to_have_count(10)
        self.assertTrue(page.evaluate('beforePanel===document.querySelector("#alternateView").firstElementChild && beforeScroll===scrollY'))
        expect(field).to_be_focused();expect(field).to_have_value(marker)
        self.assertEqual(len([u for m,u in requests if '/search?' in u]),2)
        self.assertTrue(all(m=='GET' for m,u in requests),requests)
        page.locator('#globalSearchResults [data-search-type=tickets]').first.click();expect(page.locator('#detailDialog')).to_be_visible();page.locator('#closeDetail').click()
        field.fill('NoSuchTicket'+marker);expect(page.locator('#globalSearchResults [role=status]')).to_have_text('Sin resultados.')
        delayed=[]
        page.route('**/api/search?q=Slow&**',lambda r:delayed.append(r))
        field.fill('Slow');page.wait_for_timeout(450);self.assertEqual(len(delayed),2)
        field.fill(marker);expect(page.locator('#globalSearchResults [data-search-type=tickets]')).to_have_count(10)
        for route in delayed:route.fulfill(json={'data':[{'id':999,'title':'STALE','name':'STALE'}],'total':1},headers={'Access-Control-Allow-Origin':self.origin,'Access-Control-Allow-Credentials':'true'})
        page.wait_for_timeout(100);expect(page.locator('#globalSearchResults')).not_to_contain_text('STALE')
        field.fill(self.accounts['admin']['email']);expect(page.locator('[data-search-type=users]')).to_have_count(1)
        page.locator('[data-search-type=users]').click();expect(page.locator(f'[data-user-id="{self.accounts["admin"]["id"]}"]')).to_be_focused()
        self.assertFalse(errors)

    def test_sla_filters_policy_and_responsive(self):
        ctx=self.context();page=ctx.new_page();self.login(page,'admin');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        for priority in ['Alta','Baja']:
            self.assertEqual(self.api(ctx,'POST','/tickets',{'title':'SLA filtro '+secrets.token_hex(5),'requester':'Prueba','priority':priority}).status,201)
        page.locator('[data-view=sla]').click();expect(page.locator('[data-sla-status]')).to_have_attribute('data-state','ready')
        page.locator('#slaFilter [name=priority]').select_option('Alta');page.locator('#slaFilter button').first.click()
        expect(page.locator('#slaScope')).to_contain_text('Alta');expect(page.locator('#slaTickets')).not_to_contain_text('Baja')
        page.locator('#slaFilter [name=status]').select_option('pending');page.locator('#slaFilter button').first.click();expect(page.locator('#slaScope')).to_contain_text('Pendiente')
        page.locator('#slaRefresh').click();expect(page.locator('#slaFilter [name=priority]')).to_have_value('Alta')
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state','ready');page.locator('#slaClear').click();expect(page.locator('#slaFilter [name=priority]')).to_have_value('')
        expect(page.locator('[data-sla-status]')).to_have_attribute('data-state','ready');page.locator('#slaPolicies').click()
        original=self.api(ctx,'GET','/sla/policies').json()['data'][0]
        form=page.locator('#slaPolicyForm');form.locator('[name=priority]').select_option(original['priority'])
        before=self.api(ctx,'GET','/sla/policies').json()
        for box in form.locator('[name=workday]').all():box.uncheck()
        form.locator('button').first.click();expect(page.locator('#slaPolicyFeedback')).to_contain_text('Elegí días')
        page.locator('#slaCancelPolicy').click();form.locator('button').first.click();expect(page.locator('#slaPolicyFeedback')).to_contain_text('Política guardada')
        after=self.api(ctx,'GET','/sla/policies').json()
        for b,a in zip(before['data'],after['data']):
            self.assertEqual({k:v for k,v in b.items() if k!='updatedAt'},{k:v for k,v in a.items() if k!='updatedAt'})
        for view in ['tickets','procesos','usuarios','configuracion']:
            page.locator(f'[data-view={view}]').click()
            for width in [390,768,1024,1440]:
                page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(100)
                self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width,(view,width))
                self.screenshot(page,f'v291-{view}-{width}')
        self.assertFalse(errors)

    def test_demo_search_and_sla_filters_are_local(self):
        page=self.context().new_page();page.goto(self.origin+'/login.html')
        page.locator('#email').fill('demo@example.test');page.locator('#password').fill('demo');page.locator('#loginForm button[type=submit]').click();page.wait_for_url('**/dashboard.html*')
        requests=[];page.on('request',lambda r:requests.append(r.url) if '/api/' in r.url else None)
        snapshot=page.evaluate('JSON.stringify(localStorage)')
        page.locator('#searchInput').fill('ERP');expect(page.locator('#globalSearchResults [data-search-type=tickets]').first).to_be_visible()
        for width in [390,768]:
            page.set_viewport_size({'width':width,'height':900});self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'),width)
        self.assertEqual(page.evaluate('JSON.stringify(localStorage)'),snapshot)
        page.locator('[data-view=sla]').click();expect(page.locator('[data-sla-status]')).to_have_attribute('data-state','ready');page.locator('#slaCheck').click();expect(page.locator('[data-sla-status]')).to_contain_text('Comprobación global')
        page.locator('#slaFilter [name=priority]').select_option('Alta');page.locator('#slaFilter button').first.click();expect(page.locator('#slaScope')).to_contain_text('Alta');expect(page.locator('#slaTickets')).not_to_contain_text('Baja')
        self.assertFalse(requests,requests)
