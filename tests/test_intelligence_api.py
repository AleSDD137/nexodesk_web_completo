"""V2.6 real PostgreSQL tests. Uses only dedicated nexodesk_test_* harness DB."""
import unittest
from playwright.sync_api import expect
import test_requester_portal as harness


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class IntelligenceAPI(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login

    def ticket(self, context, title):
        result = self.api(context, 'POST', '/tickets', {'title':title,'description':'VPN y red sin conexión; revisar DNS.','type':'Incidente','requester':self.accounts['requester']['name']})
        self.assertEqual(result.status, 201)
        return result.json()['data']['id']

    def test_a_local_references_decisions_and_persistence_without_ticket_mutations(self):
        staff = self.api_login('tech')
        old = self.ticket(staff, 'VPN red DNS antecedente')
        self.assertEqual(self.api(staff, 'PUT', f'/triage/{old}', {'category':'Redes / VPN','impact':'Medio','urgency':'Media','diagnosis':'Cliente VPN sin DNS; configuración comprobada.','newTest':'Prueba de conectividad','applyPriority':False}).status, 200)
        current = self.ticket(staff, 'VPN red DNS incidente')
        before = self.api(staff, 'GET', f'/tickets/{current}').json()['data']
        result = self.api(staff, 'POST', f'/tickets/{current}/intelligence', {})
        self.assertEqual(result.status, 201)
        item = result.json()['data']
        self.assertEqual(item['provider'], 'local')
        refs = {str(a['id']) for a in item['payload']['antecedents']}
        self.assertIn(str(old), refs)
        self.assertTrue(set(map(str,item['payload']['references'])) <= refs)
        accepted = self.api(staff, 'PUT', f"/intelligence/suggestions/{item['id']}/decision", {'decision':'accepted'})
        self.assertEqual(accepted.status, 200)
        self.assertEqual(int(accepted.json()['data']['decidedBy']), self.accounts['tech']['id'])
        self.assertEqual(self.api(staff, 'PUT', f"/intelligence/suggestions/{item['id']}/decision", {'decision':'discarded'}).status, 409)
        after = self.api(staff, 'GET', f'/tickets/{current}').json()['data']
        self.assertEqual(before, after)
        self.assertEqual(self.api(staff,'POST','/auth/logout',{}).status,200)
        again = self.api_login('tech')
        history = self.api(again,'GET',f'/tickets/{current}/intelligence').json()['data']
        self.assertEqual(history[0]['decision'],'accepted')
        self.assertEqual(self.api(again,'POST',f'/tickets/{current}/intelligence', {'actorId':1}).status,400)

    def test_b_authorization_and_missing_ticket(self):
        staff = self.api_login('tech2')
        ticket = self.ticket(staff, 'Equipo sin acceso')
        for context,status in [(self.api_login('requester'),403),(self.context(),401)]:
            self.assertEqual(self.api(context,'GET','/intelligence/status').status,status)
            self.assertEqual(self.api(context,'GET',f'/tickets/{ticket}/intelligence').status,status)
            self.assertEqual(self.api(context,'POST',f'/tickets/{ticket}/intelligence',{}).status,status)
            self.assertEqual(self.api(context,'PUT','/intelligence/suggestions/1/decision',{'decision':'accepted'}).status,status)
        for key in ['tech','tech2','tech3','coordinator','admin']:
            self.assertEqual(self.api(self.api_login(key),'GET','/intelligence/status').status,200)
        self.assertEqual(self.api(staff,'POST','/tickets/9007199254740000/intelligence',{}).status,404)

    def test_c_durable_hourly_limit_does_not_mutate_tickets(self):
        staff = self.api_login('tech3')
        ticket = self.ticket(staff,'VPN red rate limited')
        limits = self.api(staff,'GET','/intelligence/status').json()['data']
        self.assertEqual(limits['userHourlyLimit'],10)
        statuses = [self.api(staff,'POST',f'/tickets/{ticket}/intelligence',{}).status for _ in range(11)]
        self.assertEqual(statuses,[201]*10+[429])


if __name__ == '__main__':
    unittest.main()
