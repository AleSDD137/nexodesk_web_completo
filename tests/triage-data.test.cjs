const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const script = readFileSync(join(__dirname,'../js/triage-data.js'),'utf8');
const KEY = 'nexodesk-triage-v15';
const form = {category:'Redes / VPN',impact:'Alto',urgency:'Alta',diagnosis:'Conectividad revisada',newTest:'Prueba de enlace',applyPriority:true};

function setup(saved = {}, api = () => { throw Error('La demo no debe llamar a la API'); }) {
  const store = new Map(Object.entries(saved));
  let saves = 0;
  const ctx = {tickets:[{id:1,priority:'Baja',assignee:'Sin asignar'},{id:2}],users:[{id:5,name:'Técnico',active:true,role:'Técnico'}],saveTickets:() => saves++};
  const sandbox = {window:{NexoAuth:{api}},structuredClone,localStorage:{getItem:k => store.get(k) ?? null,setItem:(k,v) => store.set(k,v)}};
  vm.runInNewContext(script,sandbox);
  return {create:mode => sandbox.window.NexoTriageData.create(mode,ctx),store,ctx,saves:() => saves};
}
test('demo conserva el formato anterior, persiste diagnóstico, pruebas, prioridad y transferencias', async () => {
  const previous = {category:'Hardware',impact:'Bajo',urgency:'Baja',level:'L1',diagnosis:'Anterior',tests:['Prueba anterior'],history:[{title:'Anterior',text:'Registro anterior',at:1}]};
  const s = setup({[KEY]:JSON.stringify({1:previous})});
  const adapter = s.create('demo');
  assert.equal((await adapter.get(1)).tests[0].text,'Prueba anterior');
  await adapter.save(1,form);
  await adapter.transfer(1,{toLevel:2,reason:'Escalar a redes',pending:'Revisar enlace',assigneeUserId:5});
  await adapter.transfer(1,{toLevel:3,reason:'Escalar a especialista',pending:'Revisar infraestructura',assigneeUserId:null});
  const reloaded = s.create('demo');
  const r = await reloaded.get(1);
  assert.equal(r.level,'L3');
  assert.equal(r.diagnosis,form.diagnosis);
  assert.equal(r.tests.length,2);
  assert.match(r.history[0].title,/L2 → L3/);
  assert.equal(s.ctx.tickets[0].priority,'Alta');
  assert.equal(s.ctx.tickets[0].assignee,'Técnico');
  assert.equal(s.saves(),2);
  assert.equal(JSON.parse(s.store.get(KEY))[1].tests[1],form.newTest);
  await reloaded.removeTest(1,0);
  assert.equal((await reloaded.get(1)).tests.length,1);
  assert.equal((await reloaded.load()).index['1'].level,'L3');
});
test('demo exige diagnóstico/prueba y un nivel distinto antes de transferir', async () => {
  const a = setup().create('demo');
  await assert.rejects(a.transfer(1,{toLevel:2}),/diagnóstico/);
  await a.save(1,form);
  await assert.rejects(a.transfer(1,{toLevel:1}),/distinto/);
});
test('un fallo de almacenamiento no confirma guardado ni cambia el ticket', async () => {
  const sandbox = {window:{},structuredClone,localStorage:{getItem:() => null,setItem:() => { throw Error('Cuota agotada'); }}};
  vm.runInNewContext(script,sandbox);
  const ctx = {tickets:[{id:1,priority:'Baja'}],users:[],saveTickets:() => assert.fail('No debe guardar tickets')};
  await assert.rejects(sandbox.window.NexoTriageData.create('demo',ctx).save(1,form),/Cuota/);
  assert.equal(ctx.tickets[0].priority,'Baja');
});
test('API normaliza expedientes y envía operaciones sin leer ni escribir datos locales', async () => {
  const calls = [];
  const record = {level:2,tests:[{id:7,description:'Prueba de servidor',createdAt:'2026-01-01'}],history:[{kind:'Transferencia',fromLevel:1,toLevel:2,note:'Motivo',pending:'Pendiente',createdAt:'2026-01-01'}]};
  const s = setup({[KEY]:'contenido local que API no debe leer'},async (path, options) => {
    calls.push([path,options]);
    if (path.startsWith('/triage/summary')) return {data:{cases:[{ticketId:'1',level:2}]}};
    if (path === '/triage/assignees') return {data:[]};
    return {data:record};
  });
  const a = s.create('api');
  assert.equal((await a.load()).index['1'].level,'L2');
  assert.equal((await a.get(1)).tests[0].text,'Prueba de servidor');
  await a.save(1,form);
  const transfer = {toLevel:3,reason:'Motivo de prueba',pending:'Paso siguiente',assigneeUserId:null};
  const result = await a.transfer(1,transfer);
  assert.match(result.history[0].title,/L1 → L2/);
  assert.equal(a.canRemoveTests,false);
  assert.equal(a.removeTest,undefined);
  assert.equal(calls[3][1].method,'PUT');
  assert.deepEqual(JSON.parse(calls[3][1].body),form);
  assert.deepEqual(JSON.parse(calls[4][1].body),transfer);
  assert.equal(s.store.get(KEY),'contenido local que API no debe leer');
  assert.equal(s.saves(),0);
});
test('fallos API se propagan sin fallback demo', async () => {
  const s = setup({[KEY]:'{}'},async () => { throw Error('Sin conexión'); });
  await assert.rejects(s.create('api').save(1,form),/Sin conexión/);
  assert.equal(s.store.get(KEY),'{}');
  assert.equal(s.ctx.tickets[0].priority,'Baja');
});
