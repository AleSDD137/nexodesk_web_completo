const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const fixture={id:'NX-A001',kind:'Notebook',brand:'Equipo anterior',serial:'TEST-SERIAL',owner:'Responsable textual',location:'Oficina',state:'Disponible',ticketId:1};
const ctx={tickets:[{id:1}],users:[{id:1,name:'Cuenta uno',active:true},{id:2,name:'Cuenta dos',active:true}]};
const csv=(optional='',values='')=>'kind,brand,serial,owner,location,state'+optional+'\nNotebook,Equipo actualizado,TEST-SERIAL,Responsable textual,Depósito,Asignado'+values;
function load({storage,api}={}){
 const map=new Map(Object.entries(storage||{})),localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const window={NexoAuth:{api},NexoV12:{assets:()=>[fixture]}};
 const context=vm.createContext({window,localStorage,TextEncoder,structuredClone,URLSearchParams,Date,Math,JSON,Error,Object,Number,String,Set});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/inventory-data.js'),'utf8'),context);
 return {data:window.NexoInventoryData,map,localStorage};
}
test('Inventory API uses server contracts without touching Demo storage',async()=>{
 const calls=[],{data,map}=load({api:async(p,o)=>{calls.push([p,o]);return p.includes('/export')?{data:{csv:'server csv',filename:'server.csv',total:1}}:{data:[]};}});
 const adapter=data.create('api',ctx);await adapter.list({search:'SER'});await adapter.history(5);await adapter.preview({csv:'csv',updateExisting:false});await adapter.commit({csv:'csv',updateExisting:false,token:'signed'});
 assert.equal((await adapter.export({})).csv,'server csv');assert.equal(calls.length,5);assert.equal(map.size,0);
 assert.match(calls[4][0],/format=json/);assert.equal(JSON.parse(calls[3][1].body).token,'signed');
});
test('Inventory Demo respects formal owner map and preserves omitted links',async()=>{
 const {data,map}=load({storage:{'nexodesk-demo-asset-users-v25':JSON.stringify({'NX-A001':1})}}),adapter=data.create('demo',ctx);
 let form={csv:csv(),updateExisting:true},preview=(await adapter.preview(form)).data;
 await adapter.commit({...form,token:preview.token});
 let listed=(await adapter.list()).data[0];assert.equal(listed.ownerUserId,1);assert.equal(listed.ticketId,1);
 form={csv:csv(',ownerUserId,ticketId',',2,'),updateExisting:true};preview=(await adapter.preview(form)).data;await adapter.commit({...form,token:preview.token});
 assert.equal(JSON.parse(map.get('nexodesk-demo-asset-users-v25'))['NX-A001'],2);listed=(await adapter.list()).data[0];assert.equal(listed.ownerUserId,2);assert.equal(listed.ticketId,null);
 form={csv:csv(',ownerUserId',','),updateExisting:true};preview=(await adapter.preview(form)).data;await adapter.commit({...form,token:preview.token});
 assert.equal((await adapter.list()).data[0].ownerUserId,null);assert.ok((await adapter.history('NX-A001')).total>=2);
});
test('Inventory Demo rejects stale preview and rolls back auxiliary history if assets fail to persist',async()=>{
 const {data,map,localStorage}=load(),adapter=data.create('demo',ctx),form={csv:csv(),updateExisting:true},preview=(await adapter.preview(form)).data;
 const save=localStorage.setItem;localStorage.setItem=(k,v)=>{if(k==='nexodesk-demo-assets-v12')throw Error('quota');return save(k,v);};
 await assert.rejects(()=>adapter.commit({...form,token:preview.token}),/quota/);
 assert.equal(map.has('nexodesk-demo-inventory-history-v28'),false);assert.equal(map.has('nexodesk-demo-assets-v12'),false);
 localStorage.setItem=save;map.set('nexodesk-demo-assets-v12',JSON.stringify([{...fixture,location:'Otro cambio'}]));
 await assert.rejects(()=>adapter.commit({...form,token:preview.token}),/vista previa/);
});
