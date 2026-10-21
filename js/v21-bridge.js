/* V2.2: selección Demo / API con sesión. No hace fallback silencioso al navegador. */
(() => {
  'use strict';
  const MODE_KEY='nexodesk-v21-mode';
  const DATA_KEYS=['title','description','type','priority','status','requester','assignee','source'];
  const UPDATE_KEYS=['title','description','type','priority','status','requester','assignee'];
  let mode=localStorage.getItem(MODE_KEY)==='api'?'api':'demo';
  let ctx,ready=false,failed=false,seq=Promise.resolve(),shadow=new Map(),epoch=0;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const normal=t=>({...t,id:Number(t.id),comments:Array.isArray(t.comments)?t.comments:[]});
  const status=(text,state='ready')=>{
    const target=document.querySelector('#nxSyncStatus');if(target)target.textContent=text;
    const panel=document.querySelector('.nx-sync');if(panel)panel.dataset.state=state;
  };
  function payload(ticket){const x={};for(const key of DATA_KEYS)if(ticket[key]!==undefined)x[key]=ticket[key];return x;}
  const updatePayload=t=>{const x={};for(const key of UPDATE_KEYS)if(t[key]!==undefined)x[key]=t[key];return x;};
  const same=(a,b)=>JSON.stringify(updatePayload(a))===JSON.stringify(updatePayload(b));
  const requester=()=>window.NexoAuth?.isRequester();

  async function changeMode(selected){
    if(selected==='api' && !window.NexoAuth.user){
      alert('Para utilizar PostgreSQL tenés que iniciar sesión con una cuenta real.');
      location.href='login.html';return;
    }
    ++epoch;ready=false;failed=false;shadow=new Map();seq=Promise.resolve();
    mode=selected;localStorage.setItem(MODE_KEY,mode);
    document.querySelector('#nxDataMode').value=mode;
    document.querySelector('#newTicketButton').disabled=mode==='api';
    window.NexoAuth.useSource(mode);
    if(mode==='demo'){
      ready=true;ctx.setTickets(ctx.loadDemo());
      document.querySelector('#newTicketButton').disabled=false;
      status('Demo local · Tickets guardados solo en este navegador.');
      return;
    }
    ctx.setTickets([]);status('Validando sesión y cargando tickets…','loading');
    const mine=epoch;
    try {
      const response=await window.NexoAuth.api('/tickets');
      if(epoch!==mine)return;
      if(!Array.isArray(response.data))throw Error('Respuesta no válida');
      const list=response.data.map(normal);
      shadow=new Map(list.map(t=>[t.id,clone(t)]));
      ready=true;ctx.setTickets(list);
      document.querySelector('#newTicketButton').disabled=false;
      status(`API + PostgreSQL · ${list.length} ticket(s). Sesión de ${window.NexoAuth.user.name}.`);
    }catch(err){
      if(epoch!==mine)return;
      failed=true;ready=false;
      status(`Sin conexión: ${err.message}. No se guardan cambios.`, 'error');
      if(err.status===401)location.replace('login.html?expired=1');
    }
  }
  function save(raw){
    if(mode!=='api')return;
    if(!ready||failed){ctx.showToast('No se puede guardar: API desconectada.');return;}
    const snapshot=clone(raw.map(normal));const changes=[];
    for(const t of snapshot){
      const previous=shadow.get(t.id);
      if(!previous){changes.push({type:'create',ticket:t});}
      else{
        const fieldsChanged=!same(t,previous);
        const newComments=(t.comments||[]).slice((previous.comments||[]).length);
        if(fieldsChanged||newComments.length)changes.push({type:'update',ticket:t,fieldsChanged,newComments});
      }
      shadow.set(t.id,clone(t));
    }
    if(!changes.length)return;
    const mine=epoch;
    status(`Guardando ${changes.length} operación(es)…`,'saving');
    seq=seq.then(async()=>{
      for(const change of changes){
        if(mine!==epoch||failed)return;
        const ticket=change.ticket;
        let saved;
        if(change.type==='create'){
          saved=(await window.NexoAuth.api('/tickets',{method:'POST',body:JSON.stringify({...payload(ticket),comments:[]})})).data;
          // El identificador local se reemplaza por el que entregó PostgreSQL.
          const oldId=ticket.id,newId=Number(saved.id);
          const live=ctx.getTickets().find(t=>Number(t.id)===oldId);
          if(live){live.id=newId;live.requester=saved.requester;live.assignee=saved.assignee;live.priority=saved.priority;}
          shadow.delete(oldId);shadow.set(newId,normal(saved));ctx.render();
          continue;
        }
        if(change.fieldsChanged){
          if(requester())throw Error('Tu rol no permite editar los datos del ticket.');
          saved=(await window.NexoAuth.api(`/tickets/${ticket.id}`,{
            method:'PATCH',body:JSON.stringify(updatePayload(ticket))})).data;
        }
        for(const c of change.newComments){
          saved=(await window.NexoAuth.api(`/tickets/${ticket.id}/comments`,{
            method:'POST',body:JSON.stringify({text:c.text})})).data;
        }
        if(saved){
          const live=ctx.getTickets().find(t=>Number(t.id)===ticket.id);
          if(live)live.comments=saved.comments;
          shadow.set(ticket.id,normal(saved));
        }
      }
      if(mine===epoch&&!failed){ctx.render();status('API + PostgreSQL · Todos los cambios confirmados.');}
    }).catch(err=>{
      if(mine!==epoch)return;
      failed=true;ready=false;
      status(`No se guardó: ${err.message}. Presioná Actualizar para recargar el estado real.`, 'error');
      ctx.showToast('Error de guardado. Revisá el estado antes de continuar.');
      if(err.status===401)location.replace('login.html?expired=1');
    });
  }
  async function addComment(id,text){
    if(mode!=='api'||!ready||failed)throw Error('Sin conexión al servidor');
    const data=await window.NexoAuth.api(`/tickets/${id}/comments`,{method:'POST',body:JSON.stringify({text})});
    const current=ctx.getTickets().find(t=>Number(t.id)===Number(id));
    if(current)current.comments=data.data.comments;
    shadow.set(Number(id),normal(data.data));ctx.render();
  }
  function init(context){
    ctx=context;
    document.querySelector('#nxDataMode').addEventListener('change',e=>{
      if(mode==='api'&&document.querySelector('.nx-sync').dataset.state==='saving'){
        alert('Esperá que termine el guardado antes de cambiar el modo.');e.target.value=mode;return;
      }
      void changeMode(e.target.value);
    });
    document.querySelector('#nxRefresh').addEventListener('click',()=>{
      if(mode==='api'&&document.querySelector('.nx-sync').dataset.state==='saving'){
        alert('Esperá que termine el guardado.');return;
      }
      if(mode==='api'&&ready&&!confirm('Se recargarán los tickets desde el servidor. ¿Continuar?'))return;
      void changeMode(mode);
    });
    // El tipo de acceso validado en login tiene prioridad sobre la preferencia anterior.
    mode=window.NexoAuth.sessionMode==='api'?'api':'demo';
    void changeMode(mode);
  }
  window.NexoBridge={init,isServer:()=>mode==='api',save,addComment,reload:()=>changeMode(mode),isReady:()=>ready&&!failed};
})();
