/* NEXODESK V2.3: integración progresiva. Assets y Portal delegan en V1.2 en demo; Triage comparte su propia vista.
 * Ningún dato privado de Assets o Triage se copia al almacenamiento del navegador.
 */
(() => {
  'use strict';
  const oldModules=window.NexoV12.render;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const API=(route,options)=>window.NexoAuth.api(route,options);
  const real=()=>window.NexoAuth?.source==='api';
  const staff=()=>real() && window.NexoAuth?.user?.role!=='Solicitante';
  const messages={notConnected:'Conectá el servidor y PostgreSQL para continuar. No se guardaron cambios.'};
  const root=()=>document.querySelector('#alternateView');
  let generation=0, assetSearch='',lastPortalNotice='';
  const toast=(ctx,msg)=>ctx.showToast?.(msg);
  function isLive(token,view){return generation===token && real() && !!root() && document.querySelector(`.nav-item[data-view="${view}"].active`);}
  const errorText=e=>e?.message||'No se pudo completar la operación';
  function fail(box,err){box.innerHTML=`<div class="nx23-error" role="alert">${esc(errorText(err))}<p>El servidor no respondió correctamente. Los datos no se guardaron en modo demo.</p></div>`;}
  function choose(arr,value){return arr.map(x=>`<option value="${esc(x)}" ${x===value?'selected':''}>${esc(x)}</option>`).join('');}
  const panel=(head,subtitle,contents)=>`<section class="nx23-panel"><header><h3>${head}</h3><p>${subtitle}</p></header>${contents}</section>`;

  async function assetsView(ctx){
    const token=++generation, el=root();el.innerHTML=`<div class="nx23-hero"><b>ASSETS · POSTGRESQL</b><h2>Inventario centralizado</h2><p>Dispositivos registrados en el servidor. Solo visible para técnicos, coordinadores y administradores.</p></div><div class="nx23-panel">Cargando activos…</div>`;
    if(!staff()){el.innerHTML=panel('Acceso restringido','', 'Solo personal IT puede acceder al inventario.');return;}
    let data;
    try {data=(await API('/assets')).data.map(a=>({...a,id:Number(a.id),ticketId:a.ticketId===null?null:Number(a.ticketId)}));}catch(err){if(isLive(token,'assets'))fail(el,err);return;}
    if(!isLive(token,'assets'))return;
    const paint=()=>{
      const filtered=data.filter(a=>[a.id,a.kind,a.brand,a.serial,a.owner,a.location,a.state,a.ticketId].join(' ').toLowerCase().includes(assetSearch.toLowerCase()));
      el.innerHTML=`<div class="nx23-hero"><b>ASSETS · POSTGRESQL</b><h2>Inventario centralizado</h2><p>Los activos de esta sección están almacenados en el servidor, no en localStorage.</p><button id="nx23AddAsset" class="nx23-primary">+ Nuevo activo</button></div>
      <div class="nx23-metrics"><span><b>${data.length}</b>Total activos</span><span><b>${data.filter(a=>a.state==='Asignado').length}</b>Asignados</span><span><b>${data.filter(a=>a.state==='En reparación').length}</b>En reparación</span></div>
      ${panel('Dispositivos','La vinculación permite un ticket principal por activo.',`<label class="nx23-filter">Buscar<input id="nx23AssetSearch" value="${esc(assetSearch)}" placeholder="Serie, equipo, usuario, ubicación"></label>
      <div class="nx23-overflow"><table class="nx23-table"><thead><tr><th>Activo</th><th>Serie</th><th>Asignación</th><th>Estado</th><th>Ticket</th><th></th></tr></thead><tbody>${filtered.map(a=>`<tr><td><b>NX-A${esc(a.id)} · ${esc(a.brand)}</b><small>${esc(a.kind)}</small></td><td>${esc(a.serial)}</td><td>${esc(a.owner)}<small>${esc(a.location)}</small></td><td>${esc(a.state)}</td><td>${a.ticketId?`<button class="nx23-link" data-ticket-id="${Number(a.ticketId)}">#${Number(a.ticketId)} ↗</button>`:'—'}</td><td><button class="nx23-secondary" data-edit-asset="${Number(a.id)}">Editar</button></td></tr>`).join('')||'<tr><td colspan="6">Sin resultados o sin activos en PostgreSQL. Podés crear el primero.</td></tr>'}</tbody></table></div>`)}`;
      el.querySelector('#nx23AssetSearch').addEventListener('input',e=>{assetSearch=e.target.value;const pos=e.target.selectionStart;paint();const input=el.querySelector('#nx23AssetSearch');input.focus();input.setSelectionRange(pos,pos);});
      el.querySelector('#nx23AddAsset').addEventListener('click',()=>assetDialog(ctx,null,refresh));
      el.querySelectorAll('[data-edit-asset]').forEach(b=>b.addEventListener('click',()=>assetDialog(ctx,data.find(a=>a.id===Number(b.dataset.editAsset)),refresh)));
      el.querySelectorAll('[data-ticket-id]').forEach(b=>b.addEventListener('click',()=>ctx.openTicket(Number(b.dataset.ticketId))));
    };
    const refresh=async()=>{await assetsView(ctx);};
    paint();
  }
  function assetDialog(ctx,a,refresh){
    const overlay=document.createElement('div');overlay.className='nx23-overlay';
    const tickets=(ctx.tickets||[]).map(t=>`<option value="${Number(t.id)}" ${Number(a?.ticketId)===Number(t.id)?'selected':''}>#${Number(t.id)} · ${esc(t.title)}</option>`).join('');
    overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="nx23AssetTitle" class="nx23-dialog"><h3 id="nx23AssetTitle">${a?'Editar':'Nuevo'} activo (servidor)</h3><form id="nx23AssetForm" class="nx23-form">
    <label>Tipo<select name="kind">${choose(['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro'],a?.kind||'Notebook')}</select></label>
    <label>Modelo<input name="brand" required maxlength="100" minlength="2" value="${esc(a?.brand||'')}"></label>
    <label>Número de serie<input name="serial" required maxlength="70" minlength="2" value="${esc(a?.serial||'')}"></label>
    <label>Usuario asignado<input name="owner" required maxlength="120" value="${esc(a?.owner||'Sin asignar')}"></label>
    <label>Ubicación<input name="location" required maxlength="120" value="${esc(a?.location||'')}"></label>
    <label>Estado<select name="state">${choose(['Disponible','Asignado','En reparación','Baja'],a?.state||'Disponible')}</select></label>
    <label>Ticket principal<select name="ticketId"><option value="">Sin ticket</option>${tickets}</select></label>
    <p id="nx23AssetMessage" role="status"></p><div class="nx23-actions"><button class="nx23-secondary" type="button" id="nx23AssetCancel">Cancelar</button><button type="submit" class="nx23-primary">Guardar en PostgreSQL</button></div></form></section>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove();overlay.querySelector('#nx23AssetCancel').addEventListener('click',close);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelector('form').addEventListener('submit',async e=>{
      e.preventDefault();const f=e.target,fd=new FormData(f),btn=f.querySelector('[type="submit"]'),msg=f.querySelector('#nx23AssetMessage');
      const data={kind:fd.get('kind'),brand:String(fd.get('brand')).trim(),serial:String(fd.get('serial')).trim(),owner:String(fd.get('owner')).trim(),location:String(fd.get('location')).trim(),state:fd.get('state'),ticketId:fd.get('ticketId')?Number(fd.get('ticketId')):null};
      btn.disabled=true;msg.textContent='Guardando…';
      try{await API(a?`/assets/${a.id}`:'/assets',{method:a?'PATCH':'POST',body:JSON.stringify(data)});close();toast(ctx,'Activo guardado en PostgreSQL.');await refresh();}
      catch(err){msg.textContent=errorText(err);}finally{btn.disabled=false;}
    });
  }

  async function portalView(ctx){
    const token=++generation,el=root();
    el.innerHTML=`<div class="nx23-hero"><b>PORTAL · CUENTA REAL</b><h2>Mis solicitudes</h2><p>Los tickets que crees aquí se guardan en PostgreSQL y quedan asociados a tu cuenta.</p></div><div class="nx23-panel">Cargando tus solicitudes…</div>`;
    let items;
    try{items=(await API('/portal/my-requests')).data;}
    catch(err){if(isLive(token,'portal'))fail(el,err);return;}
    if(!isLive(token,'portal'))return;
    el.innerHTML=`<div class="nx23-hero"><b>PORTAL · SESIÓN VERIFICADA</b><h2>Mis solicitudes</h2><p>Hola, ${esc(window.NexoAuth.user?.name)}. Podés registrar y seguir tus solicitudes. El servidor identifica tu cuenta automáticamente.</p></div>
      ${panel('Crear una solicitud','La prioridad inicial es Media. El técnico puede ajustarla después.',`<form class="nx23-form" id="nx23PortalForm"><label>Tipo<select name="type"><option>Incidente</option><option>Requerimiento</option><option>Consulta</option></select></label><label>Asunto<input name="title" maxlength="160" minlength="3" required></label><label>Descripción<textarea name="description" maxlength="5000" minlength="5" rows="4" required></textarea></label><button type="submit" class="nx23-primary">Registrar en PostgreSQL</button><p id="nx23PortalFeedback" role="status">${esc(lastPortalNotice)}</p></form>`)}
      ${panel('Seguimiento','Solo se muestran los tickets asociados a tu cuenta real.',`<div class="nx23-overflow"><table class="nx23-table"><thead><tr><th>ID</th><th>Solicitud</th><th>Estado</th><th>Prioridad</th><th>Registrado</th></tr></thead><tbody>${items.map(t=>`<tr><td>#${Number(t.id)}</td><td><button class="nx23-link" data-portal-id="${Number(t.id)}">${esc(t.title)} ↗</button><small>${esc(t.type)}</small></td><td>${esc(t.status)}</td><td>${esc(t.priority)}</td><td>${new Date(t.createdAt).toLocaleDateString('es-AR')}</td></tr>`).join('')||'<tr><td colspan="5">Todavía no tenés solicitudes registradas desde tu cuenta.</td></tr>'}</tbody></table><div id="nx23PortalDetail" role="status"></div>`)}`;
    el.querySelectorAll('[data-portal-id]').forEach(b=>b.addEventListener('click',async()=>{
      const detail=el.querySelector('#nx23PortalDetail');detail.textContent='Cargando solicitud…';
      try{const response=await API(`/portal/requests/${Number(b.dataset.portalId)}`);if(!isLive(token,'portal'))return;
        const t=response.data;detail.innerHTML=`<div class="nx23-request-detail"><h4>#${Number(t.id)} · ${esc(t.title)}</h4><p>Estado: ${esc(t.status)} · Prioridad: ${esc(t.priority)}</p><p>${esc(t.description)}</p></div>`;}
      catch(err){detail.textContent=errorText(err);}
    }));
    el.querySelector('#nx23PortalForm').addEventListener('submit',async e=>{
      e.preventDefault();const f=e.target,fd=new FormData(f),msg=f.querySelector('#nx23PortalFeedback');const btn=f.querySelector('button[type="submit"]');btn.disabled=true;msg.textContent='Registrando…';
      try{const response=await API('/portal/requests',{method:'POST',body:JSON.stringify({type:fd.get('type'),title:String(fd.get('title')).trim(),description:String(fd.get('description')).trim()})});
        lastPortalNotice=`Solicitud #${response.data.id} creada en PostgreSQL.`;
        await window.NexoBridge.reload();if(isLive(token,'portal'))await portalView(ctx);
        toast(ctx,lastPortalNotice);
      }catch(err){msg.textContent=errorText(err);btn.disabled=false;}
    });
  }
  window.NexoV12.render=function(view,ctx){
    if(!real()||!['assets','portal'].includes(view)){return oldModules(view,ctx);}
    if(view==='assets')void assetsView(ctx);else void portalView(ctx);
  };
  window.NexoV23={version:'2.3',serverModules:['assets','triage','portal']};
})();
