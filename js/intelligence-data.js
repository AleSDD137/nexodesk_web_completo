/* Intelligence: adaptadores explícitos, sin fallback de API a almacenamiento Demo. */
(() => {
 'use strict';
 const KEY='nexodesk-demo-intelligence-v26';
 const clone=v=>structuredClone(v);
 function create(mode,ctx={}) {
  if(mode==='api')return {
   status:async()=> (await window.NexoAuth.api('/intelligence/status')).data,
   history:async id=>(await window.NexoAuth.api(`/tickets/${Number(id)}/intelligence`)).data,
   analyze:async id=>(await window.NexoAuth.api(`/tickets/${Number(id)}/intelligence`,{method:'POST',body:'{}'})).data,
   decide:async(id,decision)=>(await window.NexoAuth.api(`/intelligence/suggestions/${Number(id)}/decision`,{method:'PUT',body:JSON.stringify({decision})})).data
  };
  if(mode!=='demo')throw Error('Origen de Intelligence inválido.');
  const read=()=>{const raw=localStorage.getItem(KEY),value=raw?JSON.parse(raw):{};if(!value||typeof value!=='object'||Array.isArray(value))throw Error('El historial Demo no es válido. No se sobrescribió.');return value;};
  return {
   status:async()=>({provider:'local',externalEnabled:false,notice:'Motor local Demo. No envía información a terceros.'}),
   history:async id=>clone(read()[id]||[]).slice(0,10),
   analyze:async id=>{
    const ticket=ctx.tickets?.find(t=>String(t.id)===String(id));if(!ticket)throw Error('Ticket Demo no disponible.');
    const terms=String(ticket.title+' '+ticket.description).toLowerCase().match(/\b(vpn|red|internet|impresora|correo|equipo|acceso|software)\b/g)||[];
    const references=(ctx.tickets||[]).filter(t=>t.id!==ticket.id&&terms.some(term=>String(t.title+' '+t.description).toLowerCase().includes(term))).slice(0,5);
    const data=read(),item={id:'demo-'+Date.now()+'-'+Math.random().toString(16).slice(2),ticketId:id,provider:'local',decision:'pending',createdAt:new Date().toISOString(),payload:{analysis:'Hipótesis orientativa del motor local Demo. Las coincidencias de texto no confirman causas.',causes:['Posible problema de configuración o disponibilidad del servicio; requiere comprobación.'],tests:['Registrar el síntoma exacto y comprobar su alcance mediante pruebas autorizadas.'],procedures:['Revisar antecedentes y documentar resultados en Triage. No ejecutar cambios sin autorización.'],references:references.map(t=>t.id),antecedents:references.map(t=>({id:t.id,title:t.title,status:t.status,diagnosis:''})),notice:'Datos Demo de este navegador; no corresponden a PostgreSQL.'}};
    data[id]=[item,...(data[id]||[])];localStorage.setItem(KEY,JSON.stringify(data));return clone(item);
   },
   decide:async(id,decision)=>{
    if(!['accepted','discarded'].includes(decision))throw Error('Decisión inválida.');
    const data=read(),item=Object.values(data).flat().find(i=>i.id===id);if(!item||item.decision!=='pending')throw Error('Sugerencia inexistente o ya revisada.');
    item.decision=decision;item.decidedAt=new Date().toISOString();localStorage.setItem(KEY,JSON.stringify(data));return clone(item);
   }
  };
 }
 window.NexoIntelligenceData={create};
})();
