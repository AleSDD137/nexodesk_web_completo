/* Inventory V2.8 adapters. API never reads/writes Demo inventory. */
(()=>{'use strict';
const columns=['kind','brand','serial','owner','location','state'],optional=['ticketId','ownerUserId'];
const escCell=value=>{let text=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
const documentCsv=rows=>'\uFEFF'+[[...columns,...optional].map(escCell).join(','),...rows.map(a=>[...columns,...optional].map(k=>escCell(a[k])).join(','))].join('\r\n');
const query=params=>{const q=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!=='')q.set(k,String(v));});return '?'+q;};
function parse(text){
 if(new TextEncoder().encode(text).length>24000)throw Error('Máximo 24 KB por CSV.');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],value='',quoted=false,closed=false;
 const field=()=>{row.push(value);value='';closed=false;},line=()=>{field();if(row.some(c=>c!==''))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='\0')throw Error('Carácter inválido.');if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;}else if(c==='"'){if(value!==''||closed)throw Error('Comillas inválidas.');quoted=true;}else if(c===',')field();else if(c==='\n'||c==='\r'){line();if(c==='\r'&&text[i+1]==='\n')i++;}else{if(closed)throw Error('CSV inválido.');value+=c;}}
 if(quoted)throw Error('Comillas sin cerrar.');if(row.length||value||closed)line();if(rows.length<2||rows.length>201)throw Error('El CSV debe contener entre 1 y 200 activos.');
 const header=rows.shift().map(c=>c.trim());if(new Set(header).size!==header.length||header.some(k=>![...columns,...optional].includes(k))||columns.some(k=>!header.includes(k)))throw Error('Columnas requeridas: '+columns.join(', ')+'. Opcionales: '+optional.join(', '));
 const seen=new Set();return rows.map((cells,index)=>{const value=Object.fromEntries(header.map((k,i)=>[k,(cells[i]??'').trim()])),errors=[];if(cells.length!==header.length)errors.push('Cantidad de celdas inválida.');const serial=value.serial.toLocaleLowerCase('es');if(seen.has(serial))errors.push('Serie duplicada en archivo.');seen.add(serial);
 for(const [k,max] of [['brand',100],['serial',70],['owner',120],['location',120]])if(value[k].length<2||value[k].length>max)errors.push(k+': longitud inválida.');
 if(!['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro'].includes(value.kind))errors.push('kind: tipo inválido.');if(!['Disponible','Asignado','En reparación','Baja'].includes(value.state))errors.push('state: estado inválido.');
 for(const k of optional)if(Object.hasOwn(value,k)){if(value[k]!==''&&(!/^[1-9]\d*$/.test(value[k])||!Number.isSafeInteger(Number(value[k]))))errors.push(k+': ID inválido.');value[k]=value[k]===''?null:Number(value[k]);}
 return {line:index+2,serial:value.serial,value,errors};});
}
function create(mode,ctx){
 if(mode==='api')return {list:p=>window.NexoAuth.api('/inventory/assets'+query(p)),history:(id,p={})=>window.NexoAuth.api(`/inventory/assets/${Number(id)}/history`+query(p)),preview:f=>window.NexoAuth.api('/inventory/import/preview',{method:'POST',body:JSON.stringify(f)}),commit:f=>window.NexoAuth.api('/inventory/import/commit',{method:'POST',body:JSON.stringify(f)}),export:async p=>(await window.NexoAuth.api('/inventory/export'+query({...p,format:'json'}))).data};
 if(mode!=='demo')throw Error('Origen inválido.');
 const key='nexodesk-demo-assets-v12',historyKey='nexodesk-demo-inventory-history-v28',ownersKey='nexodesk-demo-asset-users-v25';
 const readOwners=()=>{const value=JSON.parse(localStorage.getItem(ownersKey)||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Las asociaciones Demo no tienen un formato válido.');return value;};
 const readAssets=()=>{const value=JSON.parse(localStorage.getItem(key)||JSON.stringify(window.NexoV12.assets()));if(!Array.isArray(value))throw Error('El inventario Demo no tiene un formato válido.');const owners=readOwners();return value.map(a=>({...a,ownerUserId:owners[a.id]??null,ownerUserName:ctx.users.find(u=>String(u.id)===String(owners[a.id]))?.name??null}));};
 const readHistory=()=>{const value=JSON.parse(localStorage.getItem(historyKey)||'[]');if(!Array.isArray(value))throw Error('El historial Demo no tiene un formato válido.');return value;};
 const matches=(a,p)=>!p.state||a.state===p.state;
 const search=(a,p)=>matches(a,p)&&[a.brand,a.serial,a.owner,a.location].join(' ').toLocaleLowerCase('es').includes(String(p.search||'').toLocaleLowerCase('es'));
 function preview(form){const assets=readAssets(),rows=parse(form.csv).map(row=>{const old=assets.find(a=>a.serial.toLocaleLowerCase('es')===row.serial.toLocaleLowerCase('es'));if(old&&!form.updateExisting)row.errors.push('Serie existente: autorizá actualizaciones y repetí la vista previa.');
 if(row.value.ticketId!=null&&!ctx.tickets.some(t=>String(t.id)===String(row.value.ticketId)))row.errors.push('ticketId inexistente.');if(row.value.ownerUserId!=null&&!ctx.users.some(u=>String(u.id)===String(row.value.ownerUserId)&&u.active))row.errors.push('ownerUserId inexistente o inactivo.');return {...row,action:old?'update':'create',existingId:old?.id??null};});return {rows,valid:rows.every(r=>!r.errors.length),total:rows.length,token:JSON.stringify({csv:form.csv,updateExisting:form.updateExisting,snapshot:JSON.stringify(assets)})};}
 return {
 async list(p={}){const items=readAssets().filter(a=>search(a,p));return {data:items.slice(Number(p.offset)||0,(Number(p.offset)||0)+20),total:items.length,limit:20,offset:Number(p.offset)||0};},
 async history(id,p={}){const rows=readHistory().filter(e=>String(e.assetId)===String(id)).reverse(),offset=Number(p.offset)||0;return {data:rows.slice(offset,offset+50),total:rows.length,limit:50,offset};},
 async preview(f){return {data:preview(f)};},
 async commit(form){const token=JSON.parse(form.token),before=readAssets();if(token.csv!==form.csv||token.updateExisting!==form.updateExisting||token.snapshot!==JSON.stringify(before))throw Error('La vista previa cambió. Volvé a previsualizar.');const checked=preview(form);if(!checked.valid)throw Error('El CSV tiene errores.');const history=readHistory(),items=structuredClone(before),owners=readOwners();let created=0,updated=0;
 for(const row of checked.rows){const index=items.findIndex(a=>a.serial.toLocaleLowerCase('es')===row.serial.toLocaleLowerCase('es')),old=index<0?null:items[index],value={...row.value,id:old?.id??'NX-IMP-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'-'+row.line};if(old)items[index]={...old,...value};else items.push(value);const after=index<0?value:items[index];if(Object.hasOwn(row.value,'ownerUserId')){if(row.value.ownerUserId==null)delete owners[after.id];else owners[after.id]=row.value.ownerUserId;}const changes=Object.fromEntries([...columns,...optional].filter(k=>(old?.[k]??null)!==(after[k]??null)).map(k=>[k,{old:old?.[k]??null,new:after[k]??null}]));if(Object.keys(changes).length)history.push({id:'demo-'+Date.now()+'-'+row.line,assetId:after.id,actorName:'Usuario Demo',createdAt:new Date().toISOString(),kind:'imported',changes});if(old)updated++;else created++;}
 const rawHistory=localStorage.getItem(historyKey),rawOwners=localStorage.getItem(ownersKey);try{localStorage.setItem(historyKey,JSON.stringify(history));localStorage.setItem(ownersKey,JSON.stringify(owners));localStorage.setItem(key,JSON.stringify(items));}catch(error){if(rawHistory===null)localStorage.removeItem(historyKey);else localStorage.setItem(historyKey,rawHistory);if(rawOwners===null)localStorage.removeItem(ownersKey);else localStorage.setItem(ownersKey,rawOwners);throw error;}return {data:{created,updated,total:checked.total}};},
 async export(p={}){const rows=readAssets().filter(a=>search(a,p));return {csv:documentCsv(rows),filename:'nexodesk-demo-inventory.csv',total:rows.length};}
 };
}
function saveDemoRecord(key,value,before,after,kind){
 const historyKey='nexodesk-demo-inventory-history-v28',raw=localStorage.getItem(historyKey),history=JSON.parse(raw||'[]');if(!Array.isArray(history))throw Error('El historial Demo no tiene un formato válido.');
 const changes=Object.fromEntries([...columns,...optional].filter(k=>String(before?.[k]??'')!==String(after[k]??'')).map(k=>[k,{old:before?.[k]??null,new:after[k]??null}]));
 if(Object.keys(changes).length)history.push({id:'demo-'+Date.now()+'-'+Math.random().toString(36).slice(2),assetId:after.id,actorName:'Usuario Demo',createdAt:new Date().toISOString(),kind,changes});
 localStorage.setItem(historyKey,JSON.stringify(history));try{localStorage.setItem(key,JSON.stringify(value));}catch(error){if(raw===null)localStorage.removeItem(historyKey);else localStorage.setItem(historyKey,raw);throw error;}
}
window.NexoInventoryData={create,saveDemoRecord,template:()=>documentCsv([{kind:'Notebook',brand:'Equipo de ejemplo',serial:'REEMPLAZAR-SERIE',owner:'Sin asignar',location:'Oficina',state:'Disponible'}])};
})();
