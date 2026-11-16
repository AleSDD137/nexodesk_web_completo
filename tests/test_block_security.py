"""Cross-module server boundaries for the V2.6–V2.9 integration.

Uses only the guarded isolated-PostgreSQL harness; never user credentials.
"""
import unittest

import test_requester_portal as harness


@unittest.skipUnless(harness.DATABASE, 'Set NEXODESK_TEST_DATABASE_URL to isolated PostgreSQL')
class BlockSecurity(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login

    def test_a_anonymous_and_requester_cannot_read_any_new_internal_module(self):
        paths = ['/intelligence/status', f'/tickets/{self.fixture["ticketId"]}/intelligence',
                 '/sla/policies', '/sla/tickets', '/sla/alerts',
                 '/inventory/export', '/reports/summary', '/reports/export', '/reports/export.csv']
        for account, expected in [(self.context(), 401), (self.api_login('requester'), 403)]:
            for path in paths:
                with self.subTest(path=path, expected=expected):
                    self.assertEqual(self.api(account, 'GET', path).status, expected)

    def test_b_tampered_identity_does_not_bypass_role_guards(self):
        requester = self.api_login('requester')
        attempts = [('POST', f'/tickets/{self.fixture["ticketId"]}/intelligence'),
                    ('PUT', '/intelligence/suggestions/1/decision'),
                    ('PUT', '/sla/policies/Media'), ('POST', '/sla/check'),
                    ('POST', '/sla/alerts/1/acknowledge'),
                    ('POST', '/inventory/import/preview'), ('POST', '/inventory/import/commit')]
        for method, path in attempts:
            with self.subTest(path=path):
                response = requester.request.fetch('http://127.0.0.1:3001/api' + path, method=method,
                    data={'actorId': self.accounts['admin']['id'], 'role': 'Administrador',
                          'createdAt': '2000-01-01T00:00:00Z'},
                    headers={'X-User-Id': str(self.accounts['admin']['id']), 'X-Role': 'Administrador'})
                self.assertEqual(response.status, 403)

    def test_c_cross_origin_mutations_are_rejected_before_any_side_effect(self):
        staff = self.api_login('admin')
        for path in [f'/tickets/{self.fixture["ticketId"]}/intelligence', '/sla/check', '/inventory/import/commit']:
            with self.subTest(path=path):
                response = staff.request.post('http://127.0.0.1:3001/api' + path,
                    data={}, headers={'Origin': 'https://untrusted.example'})
                self.assertEqual(response.status, 403)

    def test_d_reports_are_denied_to_technical_roles_and_accept_managers(self):
        for key in ['tech', 'tech2', 'tech3']:
            account = self.api_login(key)
            for path in ['/reports/summary', '/reports/export', '/reports/export.csv']:
                with self.subTest(key=key, path=path):
                    self.assertEqual(self.api(account, 'GET', path).status, 403)
        for key in ['admin', 'coordinator']:
            account = self.api_login(key)
            self.assertEqual(self.api(account, 'GET', '/reports/summary').status, 200)

    def test_e_role_deactivation_revokes_new_module_access(self):
        # The account remains stored; disabling it only invalidates its session.
        staff = self.api_login('tech3')
        admin = self.api_login('admin')
        user_id = self.accounts['tech3']['id']
        self.assertEqual(self.api(staff, 'GET', '/intelligence/status').status, 200)
        self.assertEqual(self.api(admin, 'PATCH', f'/users/{user_id}', {'active': False}).status, 200)
        for path in ['/intelligence/status', '/sla/policies', '/inventory/export']:
            self.assertEqual(self.api(staff, 'GET', path).status, 401)
        self.assertEqual(self.api(admin, 'PATCH', f'/users/{user_id}', {'active': True}).status, 200)
        # Reactivation must not resurrect the revoked session.
        self.assertEqual(self.api(staff, 'GET', '/intelligence/status').status, 401)


if __name__ == '__main__':
    unittest.main()
