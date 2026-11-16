"""V2.8 real isolated PostgreSQL inventory import/history/export checks."""
import json
import os
import secrets
import subprocess
import unittest
from urllib.parse import quote

import test_requester_portal as harness
from test_ticket_activity import SQL_RUNNER


@unittest.skipUnless(harness.DATABASE, 'Requires isolated PostgreSQL')
class Inventory(unittest.TestCase):
    setUpClass = classmethod(harness.RequesterPortal.setUpClass.__func__)
    stop_api = classmethod(harness.RequesterPortal.stop_api.__func__)
    context = harness.RequesterPortal.context
    api = harness.RequesterPortal.api
    api_login = harness.RequesterPortal.api_login

    def csv(self, serial=None, location='Oficina', extra_header='', extra_value=''):
        serial = serial or 'INV-' + secrets.token_hex(6)
        return 'kind,brand,serial,owner,location,state'+extra_header+'\nNotebook,Equipo de prueba,'+serial+',Responsable textual,'+location+',Disponible'+extra_value

    def preview(self, context, csv, update=False):
        response = self.api(context, 'POST', '/inventory/import/preview', {'csv':csv, 'updateExisting':update})
        self.assertEqual(response.status, 200, response.text())
        return response.json()['data']

    def commit(self, context, csv, preview, update=False):
        return self.api(context, 'POST', '/inventory/import/commit', {'csv':csv,'updateExisting':update,'token':preview['token']})

    def test_a_permissions_and_invalid_rows(self):
        for key, expected in [('requester',403),('tech',403),('admin',200),('coordinator',200)]:
            context=self.api_login(key)
            response=self.api(context,'POST','/inventory/import/preview',{'csv':self.csv(),'updateExisting':False})
            self.assertEqual(response.status,expected)
        self.assertEqual(self.api(self.context(),'GET','/inventory/export').status,401)
        self.assertEqual(self.api(self.api_login('requester'),'GET','/inventory/export').status,403)
        admin=self.api_login('admin')
        csv=self.csv('DUP-'+secrets.token_hex(4))
        duplicate=csv+'\n'+csv.split('\n')[1].lower()
        checked=self.preview(admin,duplicate)
        self.assertFalse(checked['valid']);self.assertIsNone(checked['token'])
        self.assertTrue(checked['rows'][1]['errors'])
        self.assertEqual(self.api(admin,'POST','/inventory/import/preview',{'csv':'serial\nABC','updateExisting':False}).status,400)
        bad=self.preview(admin,self.csv(extra_header=',ticketId,ownerUserId',extra_value=',999999999,999999999'))
        self.assertFalse(bad['valid']);self.assertGreaterEqual(len(bad['rows'][0]['errors']),2)

    def test_b_signed_preview_commit_replay_and_authenticated_history(self):
        admin=self.api_login('admin');serial='INV-'+secrets.token_hex(6);csv=self.csv(serial)
        checked=self.preview(admin,csv)
        self.assertTrue(checked['valid'])
        tampered=self.commit(admin,csv.replace('Oficina','Otra ubicación'),checked)
        self.assertEqual(tampered.status,409)
        wrong_actor=self.commit(self.api_login('coordinator'),csv,checked)
        self.assertEqual(wrong_actor.status,409)
        response=self.commit(admin,csv,checked)
        self.assertEqual(response.status,201,response.text())
        self.assertEqual(response.json()['data'],{'created':1,'updated':0,'total':1})
        self.assertEqual(self.commit(admin,csv,checked).status,409)
        rows=self.api(admin,'GET','/inventory/assets?search='+quote(serial)).json()['data']
        self.assertEqual(len(rows),1)
        history=self.api(admin,'GET',f"/inventory/assets/{rows[0]['id']}/history").json()
        self.assertEqual(history['total'],1)
        self.assertEqual(history['data'][0]['actorName'],self.accounts['admin']['name'])
        self.assertEqual(history['data'][0]['changes']['serial']['new'],serial)
        self.assertEqual(history['data'][0]['kind'],'imported')

    def test_c_existing_confirmation_stale_preview_and_preservation_of_links(self):
        admin=self.api_login('admin');tech=self.api_login('tech');serial='INV-'+secrets.token_hex(6)
        ticket=self.api(tech,'POST','/tickets',{'title':'Ticket de inventario','requester':'Persona','description':'Solicitud de prueba'}).json()['data']['id']
        asset={'kind':'Notebook','brand':'Equipo antiguo','serial':serial,'owner':'Texto antiguo','location':'Oficina antigua','state':'Asignado','ticketId':int(ticket)}
        response=self.api(tech,'POST','/assets',asset);self.assertEqual(response.status,201)
        asset_id=response.json()['data']['id']
        self.assertEqual(self.api(tech,'PUT',f'/relations/assets/{asset_id}/owner',{'userId':self.accounts['requester']['id']}).status,200)
        checked=self.preview(admin,self.csv(serial))
        self.assertFalse(checked['valid'])
        checked=self.preview(admin,self.csv(serial),True)
        asset['location']='Cambio posterior'
        self.assertEqual(self.api(tech,'PATCH',f'/assets/{asset_id}',asset).status,200)
        self.assertEqual(self.commit(admin,self.csv(serial),checked,True).status,409)
        checked=self.preview(admin,self.csv(serial),True)
        self.assertEqual(self.commit(admin,self.csv(serial),checked,True).status,201)
        real=self.api(admin,'GET',f'/relations/assets/{asset_id}').json()['data']
        self.assertEqual(int(real['asset']['ticketId']),int(ticket))
        self.assertEqual(int(real['asset']['ownerUserId']),self.accounts['requester']['id'])
        self.assertEqual(real['asset']['location'],'Oficina')
        history=self.api(admin,'GET',f'/inventory/assets/{asset_id}/history').json()['data']
        self.assertTrue(any(e['kind']=='created' for e in history))
        self.assertTrue(any(e['changes'].get('location',{}).get('old')=='Oficina antigua' for e in history))
        self.assertTrue(any(e['kind']=='imported' for e in history))

    def test_d_exports_all_matching_rows_and_neutralizes_formulas(self):
        admin=self.api_login('admin');marker='EXPORT-'+secrets.token_hex(6)
        result=subprocess.run(['node','--input-type=module','-e',SQL_RUNNER],cwd=harness.ROOT/'backend',
            env=dict(os.environ,DATABASE_URL=harness.DATABASE),capture_output=True,text=True,
            input=json.dumps({'sql':"INSERT INTO assets(kind,brand,serial,owner_name,location,state) SELECT 'Notebook','=FORMULA()', $1||'-'||g,'Persona','Oficina','Disponible' FROM generate_series(1,205) g",'params':[marker]}))
        self.assertEqual(result.returncode,0,result.stderr)
        response=self.api(admin,'GET','/inventory/export?search='+quote(marker)+'&format=json')
        self.assertEqual(response.status,200)
        body=response.json()['data']
        self.assertEqual(body['total'],205)
        self.assertEqual(body['csv'].count("'=FORMULA()"),205)
        listing=self.api(admin,'GET','/inventory/assets?search='+quote(marker)+'&limit=20&offset=200').json()
        self.assertEqual(listing['total'],205);self.assertEqual(len(listing['data']),5)

    def test_e_two_hundred_existing_updates_fit_bounded_import_body(self):
        admin=self.api_login('admin');marker='BATCH-'+secrets.token_hex(5)
        result=subprocess.run(['node','--input-type=module','-e',SQL_RUNNER],cwd=harness.ROOT/'backend',
            env=dict(os.environ,DATABASE_URL=harness.DATABASE),capture_output=True,text=True,
            input=json.dumps({'sql':"INSERT INTO assets(kind,brand,serial,owner_name,location,state) SELECT 'Notebook','Equipo', $1||'-'||g,'Persona','Oficina','Disponible' FROM generate_series(1,200) g",'params':[marker]}))
        self.assertEqual(result.returncode,0,result.stderr)
        csv='kind,brand,serial,owner,location,state\n'+'\n'.join(
            f'Notebook,Equipo actualizado para verificacion de lote,{marker}-{i},Persona,Oficina,Disponible' for i in range(1,201))
        self.assertLess(len(csv.encode()),24000)
        checked=self.preview(admin,csv,True)
        self.assertTrue(checked['valid']);self.assertEqual(checked['total'],200)
        self.assertGreater(len(json.dumps({'csv':csv,'token':checked['token'],'updateExisting':True}).encode()),32768)
        response=self.commit(admin,csv,checked,True)
        self.assertEqual(response.status,201,response.text())
        self.assertEqual(response.json()['data']['updated'],200)


if __name__=='__main__':
    unittest.main()
