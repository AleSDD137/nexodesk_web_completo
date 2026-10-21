/* NEXODESK V2.3: integración progresiva. En demo delega en V1.2/V1.5.
 * Ningún dato privado de Assets o Triage se copia al almacenamiento del navegador.
 */
(() => {
  'use strict';
  const oldModules=window.NexoV12.render;
  const oldTriage=window.NexoV15.render;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const API=(route,options)=>window.NexoAuth.api(route,options);
  const real=()=>window.NexoAuth?.source==='api';
  const staff=()=>real() && window.NexoAuth?.user?.role!=='Solicitante';
  const messages={notConnected:'Conectá el servidor y PostgreSQL para continuar. No se guardaron cambios.'};
  const root=()=>document.querySelector('#alternateView');
  let generation=0, assetSearch='',triageSearch='', selectedTicket=null,lastPortalNotice='';
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

  const priority=(impact,urgency)=>{const s=({Bajo:1,Medio:2,Alto:3}[impact]||2)*({Baja:1,Media:2,Alta:3}[urgency]||2);return s>=6?'Alta':s>=3?'Media':'Baja';};
  async function triageView(ctx){
    const token=++generation,el=root();
    if(!staff()){el.innerHTML=panel('Acceso restringido','', 'Solo personal IT puede gestionar Triage.');return;}
    const list=(ctx.tickets||[]).filter(t=>`${t.id} ${t.title} ${t.requester}`.toLowerCase().includes(triageSearch.toLowerCase()));
    if(!selectedTicket||!ctx.tickets.some(t=>Number(t.id)===Number(selectedTicket)))selectedTicket=list[0]?.id??null;
    const selected=ctx.tickets.find(t=>Number(t.id)===Number(selectedTicket));
    el.innerHTML=`<div class="nx23-hero"><b>TRIAGE · REGISTRO EN SERVIDOR</b><h2>Diagnóstico y escalamiento manual</h2><p>Los cambios y transferencias quedan asociados al ticket en PostgreSQL.</p></div>
      <div class="nx23-layout"><aside class="nx23-panel"><h3>Bandeja de tickets</h3><input id="nx23TriageSearch" placeholder="Buscar ticket" value="${esc(triageSearch)}"><div class="nx23-ticket-list">${list.map(t=>`<button class="nx23-ticket ${Number(t.id)===Number(selectedTicket)?'chosen':''}" data-select-ticket="${Number(t.id)}"><b>#${Number(t.id)} · ${esc(t.title)}</b><small>${esc(t.status)} · ${esc(t.priority)}</small></button>`).join('')||'Sin tickets'}</div></aside>
      <article class="nx23-triage-detail" id="nx23TriageDetail">${selected?'Cargando expediente…':'No hay tickets disponibles.'}</article></div>`;
    const input=el.querySelector('#nx23TriageSearch');
    input.addEventListener('input',e=>{triageSearch=e.target.value;const pos=e.target.selectionStart;void triageView(ctx).then(()=>{const node=root()?.querySelector('#nx23TriageSearch');if(node){node.focus();node.setSelectionRange(pos,pos);}});});
    el.querySelectorAll('[data-select-ticket]').forEach(b=>b.addEventListener('click',()=>{selectedTicket=Number(b.dataset.selectTicket);void triageView(ctx);}));
    if(!selected)return;
    let row,people;
    try{[row,people]=await Promise.all([API(`/triage/${Number(selected.id)}`),API('/triage/assignees')]);}
    catch(err){if(isLive(token,'triage'))fail(el.querySelector('#nx23TriageDetail'),err);return;}
    if(!isLive(token,'triage'))return;
    const item=row.data,assignees=people.data;
    const detail=el.querySelector('#nx23TriageDetail');
    const guidance=[
      {name:'VPN y conectividad',terms:['vpn','anyconnect','conexión','red'],steps:['Verificar Internet y mensaje de error','Comprobar estado del cliente VPN','Documentar pruebas y alcance']},
      {name:'Cuentas y permisos',terms:['contraseña','acceso','credenciales','usuario','erp'],steps:['Identificar servicio afectado','Verificar cuenta mediante procedimientos autorizados','No registrar contraseñas']},
      {name:'Equipos y hardware',terms:['notebook','equipo','monitor','batería'],steps:['Identificar modelo y activo','Documentar síntomas y pruebas físicas','Comprobar incidentes previos']},
      {name:'Correo y software',terms:['correo','outlook','software','instalar','impresora'],steps:['Identificar software y versión','Registrar el error exacto','Comprobar alcance y permisos']}];
    const tips=guidance.filter(g=>g.terms.some(w=>(selected.title+' '+selected.description).toLowerCase().includes(w))).slice(0,2);
    detail.innerHTML=`<div class="nx23-panel"><h3>#${Number(selected.id)} · ${esc(selected.title)}</h3><p>${esc(selected.status)} · ${esc(selected.requester)} · prioridad ${esc(selected.priority)}</p><button class="nx23-link" id="nx23OpenTicket">Abrir ficha del ticket ↗</button></div>
      ${panel('Clasificación y diagnóstico','Solo los técnicos confirman cambios; Intelligence ofrece guías orientativas.',`<form id="nx23Classify" class="nx23-form">
      <label>Categoría<select name="category">${choose(['Sin clasificar','Redes / VPN','Cuentas y accesos','Software','Hardware','Correo','Impresión','Otro'],item.category)}</select></label>
      <label>Impacto<select name="impact">${choose(['Bajo','Medio','Alto'],item.impact)}</select></label>
      <label>Urgencia<select name="urgency">${choose(['Baja','Media','Alta'],item.urgency)}</select></label>
      <p>Prioridad sugerida: <b id="nx23Suggested">${priority(item.impact,item.urgency)}</b> · Actual: ${esc(selected.priority)}</p>
      <label class="nx23-check"><input type="checkbox" name="applyPriority"> Aplicar prioridad sugerida al ticket</label>
      <label>Diagnóstico<textarea name="diagnosis" maxlength="2500" rows="4" placeholder="Síntomas, alcance, pruebas y conclusiones">${esc(item.diagnosis)}</textarea></label>
      <label>Nueva prueba (se agrega al historial)<textarea name="newTest" maxlength="750" rows="2"></textarea></label>
      <button class="nx23-primary" type="submit">Guardar diagnóstico</button><p class="nx23-feedback" id="nx23ClassFeedback" role="status"></p></form>`)}
      ${panel('Pruebas e historial','Registros persistentes de este expediente.',`<ol class="nx23-history">${item.tests.map(t=>`<li>${esc(t.description)}<small>${new Date(t.createdAt).toLocaleString('es-AR')}</small></li>`).join('')||'<li>Sin pruebas registradas</li>'}</ol><hr><ol class="nx23-history">${item.history.map(h=>`<li><b>${esc(h.kind)}${h.toLevel?' · L'+h.fromLevel+' → L'+h.toLevel:''}</b><span>${esc(h.note)}</span>${h.pending?`<span>Próximos pasos: ${esc(h.pending)}</span>`:''}<small>${new Date(h.createdAt).toLocaleString('es-AR')}</small></li>`).join('')||'<li>Sin eventos todavía</li>'}</ol>`)}
      ${panel('Intelligence · Apoyo al diagnóstico','Sugerencias locales por palabras clave, sin IA generativa.', tips.map(t=>`<article class="nx23-guide"><b>${esc(t.name)}</b><ul>${t.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></article>`).join('')||'<p>No se detectaron guías específicas. Continuá con el diagnóstico manual.</p>')}
      ${panel('Transferencia manual','No cambia el estado del ticket: registra el nivel y opcionalmente el responsable.',`<form id="nx23Transfer" class="nx23-form"><p>Nivel actual: <b>L${Number(item.level)}</b></p>
      <label>Destino<select name="toLevel">${[1,2,3].filter(x=>x!==Number(item.level)).map(x=>`<option value="${x}">L${x}</option>`).join('')}</select></label>
      <label>Asignar a (opcional)<select name="assigneeUserId"><option value="">Conservar responsable actual</option>${assignees.map(u=>`<option value="${Number(u.id)}">${esc(u.name)}${u.supportLevel?' · L'+u.supportLevel:''}</option>`).join('')}</select></label>
      <label>Motivo de transferencia<textarea name="reason" required minlength="10" maxlength="1800" rows="3"></textarea></label>
      <label>Qué debe hacer el siguiente nivel<textarea name="pending" required minlength="10" maxlength="1500" rows="3"></textarea></label>
      <button type="submit" class="nx23-primary">Confirmar transferencia</button><p id="nx23TransferFeedback" role="status"></p></form>`)}`;
    detail.querySelector('#nx23OpenTicket').addEventListener('click',()=>ctx.openTicket(Number(selected.id)));
    const classify=detail.querySelector('#nx23Classify');
    for(const name of ['impact','urgency'])classify.elements[name].addEventListener('change',()=>{detail.querySelector('#nx23Suggested').textContent=priority(classify.elements.impact.value,classify.elements.urgency.value);});
    classify.addEventListener('submit',async e=>{
      e.preventDefault();const f=e.target,fd=new FormData(f),msg=f.querySelector('#nx23ClassFeedback');f.querySelector('button[type="submit"]').disabled=true;
      try{await API(`/triage/${Number(selected.id)}`,{method:'PUT',body:JSON.stringify({category:fd.get('category'),impact:fd.get('impact'),urgency:fd.get('urgency'),diagnosis:String(fd.get('diagnosis')).trim(),newTest:String(fd.get('newTest')).trim(),applyPriority:fd.has('applyPriority')})});
        if(fd.has('applyPriority'))await window.NexoBridge.reload();else await triageView(ctx);
        toast(ctx,'Diagnóstico guardado en PostgreSQL.');
      }catch(err){msg.textContent=errorText(err);f.querySelector('button[type="submit"]').disabled=false;}
    });
    detail.querySelector('#nx23Transfer').addEventListener('submit',async e=>{
      e.preventDefault();const f=e.target,fd=new FormData(f),msg=f.querySelector('#nx23TransferFeedback');
      if(!confirm(`¿Registrar la transferencia de #${selected.id} a L${fd.get('toLevel')}?`))return;
      f.querySelector('button[type="submit"]').disabled=true;
      try{await API(`/triage/${Number(selected.id)}/transfer`,{method:'POST',body:JSON.stringify({toLevel:Number(fd.get('toLevel')),reason:String(fd.get('reason')).trim(),pending:String(fd.get('pending')).trim(),assigneeUserId:fd.get('assigneeUserId')?Number(fd.get('assigneeUserId')):null})});
        await window.NexoBridge.reload();toast(ctx,'Transferencia registrada en el servidor.');
      }catch(err){msg.textContent=errorText(err);f.querySelector('button[type="submit"]').disabled=false;}
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
  window.NexoV15.render=function(ctx){if(!real())return oldTriage(ctx);void triageView(ctx);};
  window.NexoV23={version:'2.3',serverModules:['assets','triage','portal']};
})();
