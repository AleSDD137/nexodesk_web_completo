const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const code = readFileSync(join(__dirname,'../js/modules-data.js'),'utf8');
const ASSETS = 'nexodesk-demo-assets-v12', TICKETS = 'nexodesk-demo-tickets-v1';
const asset = {kind:'Notebook',brand:'Equipo prueba',serial:'NX-TEST',owner:'Prueba',location:'Oficina',state:'Asignado',ticketId:42};
const request = {type:'Incidente',title:'Solicitud prueba',description:'Descripción de prueba',requester:'Usuario demo',priority:'Alta'};
function setup({saved={},api=()=>assert.fail('Demo no debe llamar API'),failWrite,forbidStorage=false}={}) {
  const store=new Map(Object.entries(saved)),events=[];
  const ctx={tickets:[{id:42,title:'Ticket demo',requester:'Prueba'}]};
  const sandbox={structuredClone,CustomEvent:class {constructor(type){this.type=type;}},window:{NexoAuth:{api},NexoV12:{assets:()=>[{...asset,id:'NX-A001'}]},dispatchEvent:e=>events.push(e.type)},localStorage:{
    getItem:key=>{assert.equal(forbidStorage,false,'API must not read storage');return store.get(key)??null;},
    setItem:(key,value)=>{assert.equal(forbidStorage,false,'API must not write storage');if(failWrite?.(key))throw Error('Cuota agotada');store.set(key,value);}
  }};
  vm.runInNewContext(code,sandbox);
  return {data:sandbox.window.NexoModulesData,store,ctx,events};
}
test('Assets demo conserva IDs y vinculación, permite crear/editar y rechaza serie duplicada',async()=>{
  const s=setup(),a=s.data.assets('demo',s.ctx);
  assert.equal((await a.list()).items[0].id,'NX-A001');
  const created=await a.save(null,{...asset,serial:'NUEVO'});
  assert.equal(created.id,'NX-A002');
  await a.save(created.id,{...asset,serial:'NUEVO',location:'Depósito'});
  const saved=JSON.parse(s.store.get(ASSETS));
  assert.equal(saved[1].location,'Depósito');assert.equal(saved[1].ticketId,42);
  await assert.rejects(a.save(null,{...asset,serial:'nuevo'}),e=>e.status===409);
  assert.equal((await a.list()).items.length,2);
});
test('Assets API usa cuerpo completo y no accede a localStorage',async()=>{
  const calls=[],s=setup({forbidStorage:true,api:async(path,opts)=>{calls.push([path,opts]);return opts?{data:{...asset,id:'9'}}:{data:[{...asset,id:'9',ticketId:'42'}],limit:200};}});
  const a=s.data.assets('api',s.ctx);
  const list=await a.list();assert.equal(list.items[0].ticketId,42);assert.equal(list.limit,200);
  await a.save(9,{...asset,metadata:'omit'});
  assert.equal(calls[1][0],'/assets/9');assert.equal(calls[1][1].method,'PATCH');
  assert.deepEqual(JSON.parse(calls[1][1].body),asset);
});
test('Portal demo persiste antes de actualizar contexto y permite seguimiento',async()=>{
  const s=setup(),p=s.data.portal('demo',s.ctx);
  const created=await p.create(request);
  assert.equal(created.id,10301);assert.equal(created.status,'Registrado');assert.equal(created.source,'Portal');
  assert.equal((await p.get(10301)).requester,'Usuario demo');
  assert.equal(JSON.parse(s.store.get(TICKETS))[0].priority,'Alta');
  assert.equal(s.ctx.tickets[0].id,10301);assert.equal(s.events[0],'nexodesk:tickets-changed');
});
test('Portal API solo envía título/tipo/descripción y consulta solicitudes propias',async()=>{
  const calls=[],s=setup({forbidStorage:true,api:async(path,opts)=>{calls.push([path,opts]);return path==='/portal/my-requests'?{data:[],limit:100}:{data:{id:7,priority:'Media'}};}});
  const p=s.data.portal('api',s.ctx);
  assert.equal((await p.list()).limit,100);
  await p.create({...request,requesterEmail:'ignored@example.test',status:'Cerrado'});
  assert.deepEqual(JSON.parse(calls[1][1].body),{type:request.type,title:request.title,description:request.description});
  await p.get(7);assert.equal(calls[2][0],'/portal/requests/7');
  assert.equal(s.ctx.tickets.length,1);
});
test('Portal público siempre usa demo y ve registros de otra instancia local',async()=>{
  const s=setup({saved:{[TICKETS]:'[]'}}),p=s.data.portal('api',s.ctx,{publicMode:true});
  assert.equal(p.mode,'demo');assert.equal((await p.list()).items.length,0);
  const created=await p.create(request);
  const second=s.data.portal('demo',{tickets:[]},{publicMode:true});
  assert.equal((await second.get(created.id)).title,request.title);
  assert.equal(s.ctx.tickets.length,1);
});
test('Cuota agotada no confirma alta ni cambia contexto; fallo de actividad no invalida guardado',async()=>{
  const s=setup({failWrite:key=>key===TICKETS});
  await assert.rejects(s.data.portal('demo',s.ctx).create(request),/Cuota/);
  assert.equal(s.ctx.tickets.length,1);
  const activityFailure=setup({failWrite:key=>key==='nexodesk-demo-activity-v12'});
  const created=await activityFailure.data.assets('demo',activityFailure.ctx).save(null,{...asset,serial:'NEW'});
  assert.equal(created.id,'NX-A002');
});
test('Errores API se propagan sin fallback ni datos cruzados',async()=>{
  const s=setup({forbidStorage:true,api:async()=>{throw Error('Sin conexión');}});
  await assert.rejects(s.data.assets('api',s.ctx).save(null,asset),/Sin conexión/);
  await assert.rejects(s.data.portal('api',s.ctx).create(request),/Sin conexión/);
  assert.equal(s.ctx.tickets.length,1);
});
test('Datos demo inválidos no se sobrescriben',async()=>{
  const s=setup({saved:{[ASSETS]:'{}',[TICKETS]:'{}'}});
  await assert.rejects(s.data.assets('demo',s.ctx).save(null,asset),/formato/);
  await assert.rejects(s.data.portal('demo',s.ctx,{publicMode:true}).create(request),/formato/);
  await assert.rejects(s.data.portal('demo',s.ctx).create(request),/formato/);
  assert.equal(s.store.get(ASSETS),'{}');assert.equal(s.store.get(TICKETS),'{}');
});
test('Portal demo conserva solicitudes persistidas desde otra pestaña',async()=>{
  const s=setup({saved:{[TICKETS]:JSON.stringify([{id:10309,title:'Otra pestaña'}])}});
  const created=await s.data.portal('demo',s.ctx).create(request);
  assert.equal(created.id,10310);
  assert.equal(s.ctx.tickets[1].title,'Otra pestaña');
  assert.equal(JSON.parse(s.store.get(TICKETS)).length,2);
});
