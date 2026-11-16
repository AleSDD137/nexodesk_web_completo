const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(mode='demo',api){const storage=new Map(),ctx={window:{NexoAuth:{api}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},Intl,Date,JSON,crypto:require('node:crypto').webcrypto,URLSearchParams,Error,Number,String,Map,Set,Array,Object,structuredClone};vm.runInNewContext(fs.readFileSync('js/sla-data.js','utf8'),ctx);return {storage,mod:ctx.window.NexoSlaData};}
test('Demo SLA stores explicit enrollment and records future public response/closure/reopening',async()=>{
 const {storage,mod}=setup(),tickets=[{id:1,title:'Demo SLA',priority:'Media',status:'Registrado'}];const adapter=mod.create('demo',{tickets});
 await adapter.check();let r=mod.demoRecords()[0];assert.equal(r.firstResponseAt,null);assert.equal(r.resolvedAt,null);
 mod.onDemoPublicComment(1);const response=mod.demoRecords()[0].firstResponseAt;assert.ok(response);mod.onDemoPublicComment(1);assert.equal(mod.demoRecords()[0].firstResponseAt,response);
 tickets[0].status='Cerrado';mod.onDemoTicketsSaved(tickets);r=mod.demoRecords()[0];assert.equal(r.status,'Cerrado');assert.ok(r.resolvedAt);
 tickets[0].status='En atención';mod.onDemoTicketsSaved(tickets);r=mod.demoRecords()[0];assert.equal(r.cycle,2);assert.equal(r.resolvedAt,null);assert.equal(r.firstResponseAt,response);
 assert.equal(storage.size,1);
});
test('Demo SLA preserves invalid stored data and does not guess historic comments',async()=>{
 const {storage,mod}=setup();storage.set('nexodesk-demo-sla-v27','bad json');await assert.rejects(mod.create('demo',{tickets:[]}).check());assert.equal(storage.get('nexodesk-demo-sla-v27'),'bad json');
});
test('API SLA uses endpoints only and propagates errors without Demo fallback',async()=>{
 const calls=[],{storage,mod}=setup('api',async(p,o)=>{calls.push([p,o]);if(p==='/sla/check')throw Object.assign(Error('Fallo API'),{status:503});return {data:[]};});
 const adapter=mod.create('api',{});await adapter.policies();await adapter.tickets({priority:'Alta',offset:20});await adapter.alerts({offset:0});await assert.rejects(adapter.check({after:0,limit:100}));await adapter.ack(7);
 assert.equal(storage.size,0);assert.equal(calls[0][0],'/sla/policies');assert.match(calls[1][0],/priority=Alta/);assert.equal(calls.at(-1)[0],'/sla/alerts/7/acknowledge');
});
test('Demo escalation produces one proposal without changing a ticket',async()=>{
 const {storage,mod}=setup(),tickets=[{id:1,title:'Demo overdue',priority:'Media',status:'Registrado'}];const adapter=mod.create('demo',{tickets});await adapter.check();let d=JSON.parse(storage.get('nexodesk-demo-sla-v27'));d.records[1].responseDueAt='2000-01-01T00:00:00Z';d.records[1].policy.escalationEnabled=true;storage.set('nexodesk-demo-sla-v27',JSON.stringify(d));await adapter.check();await adapter.check();const a=(await adapter.alerts()).data;assert.equal(a.filter(a=>a.kind==='escalation').length,1);assert.equal(tickets[0].status,'Registrado');
});
