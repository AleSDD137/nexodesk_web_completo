"""V2.7 real PostgreSQL/API regression, only isolated nexodesk_test_* databases."""
import json
import os
import secrets
import subprocess
import unittest
import test_requester_portal as harness
from test_ticket_activity import SQL_RUNNER

@unittest.skipUnless(harness.DATABASE, 'Set isolated NEXODESK_TEST_DATABASE_URL')
class Sla(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login

    def sql(self, statement, params=None):
        result = subprocess.run(['node','--input-type=module','-e',SQL_RUNNER],cwd=harness.ROOT/'backend',
            env=dict(os.environ,DATABASE_URL=harness.DATABASE),input=json.dumps({'sql':statement,'params':params or []}),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        return json.loads(result.stdout)

    def ticket(self, staff, **extra):
        fields={'title':'SLA fixture '+secrets.token_hex(8),'description':'Verificación de plazos y permisos.',
                'requester':self.accounts['requester']['name'],'requesterEmail':self.accounts['requester']['email']}
        response=self.api(staff,'POST','/tickets',dict(fields,**extra));self.assertEqual(response.status,201)
        return int(response.json()['data']['id'])

    def record(self, ticket):
        return self.sql('SELECT * FROM ticket_sla WHERE ticket_id=$1',[ticket])[0]

    def test_a_new_ticket_enrolled_and_public_staff_response_only(self):
        staff,requester=self.api_login('tech'),self.api_login('requester')
        response=self.api(requester,'POST','/portal/requests',{'title':'SLA Portal '+secrets.token_hex(8),'description':'Prueba de primera respuesta.','type':'Incidente'})
        self.assertEqual(response.status,201);ticket=int(response.json()['data']['id'])
        before=self.record(ticket)
        ticket_created=self.sql('SELECT created_at FROM tickets WHERE id=$1',[ticket])[0]['created_at']
        self.assertEqual(before['started_at'],ticket_created)
        self.assertIsNone(before['first_response_at'])
        self.assertEqual(self.api(requester,'POST',f'/tickets/{ticket}/comments',{'text':'Respuesta del solicitante'}).status,201)
        self.assertIsNone(self.record(ticket)['first_response_at'])
        self.assertEqual(self.api(staff,'POST',f'/tickets/{ticket}/notes',{'content':'Nota interna no cuenta como primera respuesta'}).status,201)
        self.assertIsNone(self.record(ticket)['first_response_at'])
        self.assertEqual(self.api(staff,'POST',f'/tickets/{ticket}/comments',{'text':'Respuesta pública del técnico'}).status,201)
        milestone=self.record(ticket)['first_response_at'];self.assertIsNotNone(milestone)
        self.assertEqual(self.api(staff,'POST',f'/tickets/{ticket}/comments',{'text':'Segunda respuesta pública'}).status,201)
        self.assertEqual(self.record(ticket)['first_response_at'],milestone)
        self.assertEqual(self.api(staff,'PATCH',f'/tickets/{ticket}',{'status':'Cerrado'}).status,200)
        closed=self.record(ticket);self.assertIsNotNone(closed['resolved_at'])
        self.assertEqual(self.api(staff,'PATCH',f'/tickets/{ticket}',{'status':'En atención'}).status,200)
        reopened=self.record(ticket);self.assertIsNone(reopened['resolved_at']);self.assertEqual(reopened['cycle'],2)
        self.assertEqual(reopened['response_due_at'],before['response_due_at'])
        self.assertEqual(reopened['first_response_at'],milestone)
        closed_initial=self.ticket(staff,status='Cerrado')
        self.assertIsNotNone(self.record(closed_initial)['resolved_at'])

    def test_b_policy_permissions_validation_and_immutable_snapshots(self):
        admin,tech=self.api_login('admin'),self.api_login('tech')
        ticket=self.ticket(tech);original_snapshot=self.record(ticket)
        original=next(p for p in self.api(admin,'GET','/sla/policies').json()['data'] if p['priority']=='Media')
        fields={k:v for k,v in original.items() if k not in ['priority','updatedAt']}
        changed=dict(fields,responseMinutes=60,resolutionMinutes=120,timezone='UTC',weekdays=[0,1,2,3,4,5,6],startMinute=0,endMinute=1440,escalationEnabled=True,escalationLevel=3)
        self.assertEqual(self.api(tech,'PUT','/sla/policies/Media',changed).status,403)
        try:
            self.assertEqual(self.api(admin,'PUT','/sla/policies/Media',changed).status,200)
            self.assertEqual(self.record(ticket),original_snapshot)
            new=self.ticket(tech);snapshot=self.record(new)['policy']
            self.assertEqual(snapshot['responseMinutes'],60);self.assertEqual(snapshot['timezone'],'UTC')
            for invalid in [dict(changed,timezone='Invented/Zone'),dict(changed,weekdays=[]),dict(changed,weekdays=[1,1]),dict(changed,endMinute=1),dict(changed,authorId=1),dict(changed,responseMinutes=200,resolutionMinutes=100),dict(changed,weekdays=[1],startMinute=60,endMinute=120,resolutionMinutes=10080)]:
                self.assertEqual(self.api(admin,'PUT','/sla/policies/Media',invalid).status,400)
        finally:
            self.assertEqual(self.api(admin,'PUT','/sla/policies/Media',fields).status,200)

    def test_c_checks_and_acknowledgements_idempotent_and_alert_only(self):
        staff=self.api_login('tech');ticket=self.ticket(staff)
        self.sql("UPDATE ticket_sla SET response_due_at=clock_timestamp()-interval '2 minutes',resolution_due_at=clock_timestamp()-interval '1 minute',policy=jsonb_set(policy,'{escalationEnabled}','true') WHERE ticket_id=$1",[ticket])
        before=self.api(staff,'GET',f'/tickets/{ticket}').json()['data']
        for _ in range(2):
            response=self.api(staff,'POST','/sla/check',{'after':ticket-1,'limit':1});self.assertEqual(response.status,200)
        alerts=self.sql('SELECT * FROM sla_alerts WHERE ticket_id=$1 ORDER BY id',[ticket])
        self.assertEqual({a['kind'] for a in alerts},{'response_breach','resolution_breach','escalation'})
        self.assertEqual(len(alerts),3)
        self.assertEqual(self.api(staff,'GET',f'/tickets/{ticket}').json()['data'],before)
        alert=int(alerts[0]['id'])
        self.assertEqual(self.api(staff,'POST',f'/sla/alerts/{alert}/acknowledge',{}).status,200)
        first=self.sql('SELECT * FROM sla_alerts WHERE id=$1',[alert])[0]
        self.assertEqual(int(first['acknowledged_by']),self.accounts['tech']['id'])
        again=self.api_login('admin')
        self.assertEqual(self.api(again,'POST',f'/sla/alerts/{alert}/acknowledge',{}).status,200)
        self.assertEqual(self.sql('SELECT * FROM sla_alerts WHERE id=$1',[alert])[0],first)
        self.assertEqual(self.api(staff,'POST','/sla/check',{'after':ticket-1,'limit':101}).status,400)
        self.assertEqual(self.api(staff,'POST','/sla/check',{'timestamp':'2090-01-01'}).status,400)
        self.assertEqual(self.api(staff,'POST',f'/sla/alerts/{alert}/acknowledge',{'actorId':1}).status,400)
        self.assertEqual(self.api(staff,'POST','/auth/logout',{}).status,200)
        login=self.api_login('tech')
        self.assertTrue(any(int(a['id'])==alert for a in self.api(login,'GET','/sla/alerts').json()['data']))

    def test_d_legacy_enrollment_starts_now_and_repeated_migration_keeps_records(self):
        staff=self.api_login('tech')
        ticket=int(self.sql("INSERT INTO tickets(title,requester,created_at) VALUES('SLA legacy fixture','Persona histórica','2000-01-01') RETURNING id")[0]['id'])
        response=self.api(staff,'POST','/sla/check',{'after':ticket-1,'limit':1})
        self.assertEqual(response.status,200);self.assertEqual(response.json()['data']['enrolled'],1)
        before=self.record(ticket);self.assertGreater(before['started_at'],'2020')
        self.assertIsNone(before['first_response_at']);self.assertIsNone(before['resolved_at'])
        migration=(harness.ROOT/'backend/sql/008_sla.sql').read_text()
        self.sql(migration+migration)
        self.assertEqual(self.record(ticket),before)
        self.assertEqual(self.api(staff,'POST','/sla/check',{'after':ticket-1,'limit':1}).json()['data']['enrolled'],0)

    def test_e_authorization_all_roles_and_no_sensitive_payloads(self):
        for key in ['tech','tech2','tech3','coordinator','admin']:
            c=self.api_login(key)
            for path in ['/sla/policies','/sla/tickets','/sla/alerts']:
                self.assertEqual(self.api(c,'GET',path).status,200)
        for c,status in [(self.context(),401),(self.api_login('requester'),403)]:
            for method,path,body in [('GET','/sla/policies',None),('GET','/sla/tickets',None),('GET','/sla/alerts',None),('POST','/sla/check',{}),('POST','/sla/alerts/1/acknowledge',{}),('PUT','/sla/policies/Media',{})]:
                self.assertEqual(self.api(c,method,path,body).status,status)

    def test_f_response_and_resolution_roll_back_with_ticket_write(self):
        staff=self.api_login('tech');ticket=self.ticket(staff)
        before_ticket=self.api(staff,'GET',f'/tickets/{ticket}').json()['data'];before_sla=self.record(ticket)
        suffix=secrets.token_hex(6);function='sla_test_failure_'+suffix;trigger='sla_test_trigger_'+suffix
        self.sql(f"CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ticket_id={ticket} THEN RAISE EXCEPTION 'Injected SLA fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER {trigger} BEFORE UPDATE ON ticket_sla FOR EACH ROW EXECUTE FUNCTION {function}()")
        try:
            self.assertEqual(self.api(staff,'PATCH',f'/tickets/{ticket}',{'status':'Cerrado'}).status,500)
            self.assertEqual(self.api(staff,'POST',f'/tickets/{ticket}/comments',{'text':'Debe revertirse con SLA'}).status,500)
            self.assertEqual(self.record(ticket),before_sla)
            self.assertEqual(self.api(staff,'GET',f'/tickets/{ticket}').json()['data'],before_ticket)
        finally:
            self.sql(f'DROP TRIGGER {trigger} ON ticket_sla; DROP FUNCTION {function}()')

    def test_g_completed_late_milestone_is_breached_not_pending(self):
        staff=self.api_login('tech');ticket=self.ticket(staff,priority='Crítica')
        self.sql("UPDATE ticket_sla SET response_due_at=clock_timestamp()-interval '3 minutes',first_response_at=clock_timestamp()-interval '2 minutes',resolution_due_at=clock_timestamp()+interval '1 hour' WHERE ticket_id=$1",[ticket])
        data=self.api(staff,'GET','/sla/tickets?priority=Cr%C3%ADtica&status=breached&limit=100').json()['data']
        record=next(r for r in data if int(r['id'])==ticket)
        self.assertEqual(record['responseState'],'breached');self.assertEqual(record['resolutionState'],'pending')
        pending=self.api(staff,'GET','/sla/tickets?priority=Cr%C3%ADtica&status=pending&limit=100').json()['data']
        self.assertFalse(any(int(r['id'])==ticket for r in pending))

if __name__=='__main__': unittest.main()
