/* NEXODESK V1.2 · Módulos frontend. Sin backend / sin autenticación real. */
(() => {
  'use strict';
  const ASSETS_KEY = 'nexodesk-demo-assets-v12';
  const ACTIVITY_KEY = 'nexodesk-demo-activity-v12';
  const TICKETS_KEY = 'nexodesk-demo-tickets-v1';
  const seedAssets = [
    {id:'NX-A001',kind:'Notebook',brand:'HP ProBook 450',serial:'HP-45-DEMO',owner:'María López',location:'Oficina central',state:'Asignado',ticketId:10301},
    {id:'NX-A002',kind:'Tablet',brand:'Samsung Tab A9',serial:'SM-A9-DEMO',owner:'Juan Pérez',location:'Campo Norte',state:'Asignado',ticketId:null},
    {id:'NX-A003',kind:'Notebook',brand:'Dell Latitude 5420',serial:'DL-54-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null},
    {id:'NX-A004',kind:'Teléfono',brand:'Samsung Galaxy A55',serial:'SM-55-DEMO',owner:'Lucía Torres',location:'Oficina central',state:'En reparación',ticketId:10294},
    {id:'NX-A005',kind:'Monitor',brand:'HP E233',serial:'HP-E233-DEMO',owner:'Sofía Díaz',location:'Campo Sur',state:'Asignado',ticketId:null},
    {id:'NX-A006',kind:'Tablet',brand:'Apple iPad 9',serial:'AP-IP9-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null}
  ];
  const guides = [
    {id:'vpn',icon:'◈',category:'Conectividad',title:'No puedo conectarme a la VPN',details:['Comprobá que tengas conexión a Internet.','Cerrá y abrí de nuevo el cliente VPN.','Verificá que no estés usando una contraseña antigua.','Si persiste, creá un ticket e indicá el mensaje de error.']},
    {id:'password',icon:'◇',category:'Accesos',title:'Olvidé mi contraseña',details:['Comprobá que el teclado esté en el idioma correcto.','Si tu empresa dispone de restablecimiento de contraseña, utilizá ese canal autorizado.','No compartas contraseñas por tickets.','Solicitá ayuda a soporte si seguís sin poder ingresar.']},
    {id:'printer',icon:'▤',category:'Dispositivos',title:'La impresora no responde',details:['Comprobá que esté encendida y sin mensajes de error.','Verificá si hay papel o atascos.','Revisá la impresora seleccionada en Windows.','Creá un ticket si el problema continúa.']},
    {id:'software',icon:'▣',category:'Software',title:'Necesito instalar una aplicación',details:['Identificá la aplicación y la versión necesaria.','Verificá si requiere aprobación o licencia.','No descargues instaladores no autorizados.','Creá una solicitud de instalación para IT.']}
  ];
  const clone = v => JSON.parse(JSON.stringify(v));
  const read = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : clone(fallback); } catch { return clone(fallback); } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { alert('No se pudo guardar. Revisá el almacenamiento del navegador.'); return false; } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const assets = () => read(ASSETS_KEY, seedAssets);
  const activity = () => read(ACTIVITY_KEY, []);
  const tickets = () => read(TICKETS_KEY, []);
  const time = () => new Date().toLocaleString('es-AR', {dateStyle:'short',timeStyle:'short'});
  const track = (type, detail) => { let log = activity(); log.unshift({id:Date.now(), type, detail, date:time()}); write(ACTIVITY_KEY,log.slice(0,50)); };
  const badge = (text) => `<span class="nx-pill">${esc(text)}</span>`;
  const empty = message => `<div class="nx-empty">${esc(message)}</div>`;
  const notify = (ctx, msg) => { if(ctx?.showToast)ctx.showToast(msg); else { const node=document.querySelector('#portalStatus'); if(node){node.textContent=msg;node.hidden=false;} } };
  function linkTicket(id, ctx) { const ticket=ctx.tickets.find(t=>String(t.id)===String(id)); if(ticket)ctx.openTicket(ticket.id); else notify(ctx,'Ese ticket no está disponible en este navegador.'); }
  function pulse(ctx, el) {
    const open=ctx.tickets.filter(t=>t.status!=='Cerrado');
    const critical=open.filter(t=>t.priority==='Alta');
    const unassigned=open.filter(t=>t.assignee==='Sin asignar');
    const linked=assets().filter(a=>a.ticketId && open.some(t=>String(t.id)===String(a.ticketId)));
    const score=Math.max(0,Math.round(100-(critical.length*12)-(unassigned.length*7)-(linked.length*4)));
    const allActivity=activity();
    const statusRows=['Registrado','En revisión','En atención','Validación','Cerrado'].map(status=>{
      const n=ctx.tickets.filter(t=>t.status===status).length;
      return `<div class="nx-bar-row"><span>${esc(status)}</span><div class="nx-progress"><i style="width:${ctx.tickets.length?Math.round(n/ctx.tickets.length*100):0}%"></i></div><b>${n}</b></div>`;
    }).join('');
    el.innerHTML=`<div class="nx-hero"><div><span class="nx-kicker">● ESTADO OPERATIVO · DATOS LOCALES</span><h2>Pulse: tu soporte, en tiempo real*</h2><p>Una vista unificada de la carga de trabajo y los dispositivos relacionados. *Se actualiza al cambiar datos en este navegador; no monitorea infraestructura real.</p></div><div class="nx-health"><div class="nx-gauge" style="--score:${score}"><strong>${score}</strong><small>/100</small></div><span>Índice demo de atención</span></div></div>
    <div class="nx-metrics"><article><small>Tickets abiertos</small><strong>${open.length}</strong><span>Solicitudes por resolver</span></article><article class="nx-alert"><small>Alta prioridad</small><strong>${critical.length}</strong><span>Necesitan seguimiento</span></article><article><small>Sin responsable</small><strong>${unassigned.length}</strong><span>Pendientes de asignar</span></article><article><small>Activos vinculados</small><strong>${linked.length}</strong><span>Con ticket abierto</span></article></div>
    <div class="nx-two-col"><section class="nx-panel"><div class="nx-panel-head"><h3>Flujo de atención</h3><button class="nx-mini-btn" data-go-view="dashboard">Abrir Kanban ↗</button></div>${statusRows}</section><section class="nx-panel"><div class="nx-panel-head"><h3>Requieren atención</h3><span>${critical.length} prioritarios</span></div>${critical.length?critical.slice(0,5).map(t=>`<button class="nx-list-entry" data-ticket="${esc(t.id)}"><span><b>#${esc(t.id)} · ${esc(t.title)}</b><small>${esc(t.assignee)} · ${esc(t.status)}</small></span><span class="nx-pill nx-danger">Alta ↗</span></button>`).join(''):empty('Sin tickets abiertos de prioridad alta.')}</section></div>
    <div class="nx-two-col"><section class="nx-panel"><div class="nx-panel-head"><h3>Última actividad del prototipo</h3><span>50 eventos máximo</span></div>${allActivity.length?allActivity.slice(0,8).map(a=>`<div class="nx-event"><span class="nx-event-dot"></span><div><b>${esc(a.type)}</b><p>${esc(a.detail)}</p><small>${esc(a.date)}</small></div></div>`).join(''):empty('Todavía no hay eventos. Probá creando un activo o una solicitud en Portal.')}</section><section class="nx-panel"><div class="nx-panel-head"><h3>Accesos rápidos</h3></div><div class="nx-quick"><button data-go-view="assets">▣ Gestionar inventario <span>→</span></button><button data-go-view="portal">⌂ Crear solicitud <span>→</span></button><button data-go-view="tickets">▤ Revisar tickets <span>→</span></button><a href="portal.html">↗ Abrir Portal público <span>→</span></a></div><p class="nx-hint">El índice Pulse es una fórmula ilustrativa, no un SLA ni una medición de disponibilidad real.</p></section></div>`;
  }
  function assetRow(a, ctx) {
    const hasTicket=a.ticketId && ctx.tickets.some(t=>String(t.id)===String(a.ticketId));
    return `<tr><td><strong>${esc(a.id)}</strong><small class="nx-sub">${esc(a.kind)}</small></td><td>${esc(a.brand)}<small class="nx-sub">Serie: ${esc(a.serial)}</small></td><td>${esc(a.owner)}</td><td>${esc(a.location)}</td><td>${badge(a.state)}</td><td>${hasTicket?`<button class="nx-text-btn" data-ticket="${esc(a.ticketId)}">#${esc(a.ticketId)} ↗</button>`:'—'}</td><td><button class="nx-mini-btn" data-edit-asset="${esc(a.id)}">Editar</button></td></tr>`;
  }
  function assetsView(ctx, el) {
    const data=assets(); const q=(el.dataset.query||'').toLowerCase();
    const filtered=data.filter(a=>[a.id,a.kind,a.brand,a.serial,a.owner,a.location,a.state,a.ticketId].join(' ').toLowerCase().includes(q));
    el.innerHTML=`<div class="nx-hero nx-hero-assets"><div><span class="nx-kicker">INVENTARIO IT · ASSETS</span><h2>Los equipos y sus incidentes, conectados.</h2><p>Registrá dispositivos, seguí asignaciones y vinculá un ticket con un activo. Datos de demostración almacenados localmente.</p></div><button class="nx-cta" id="nxAddAsset">＋ Nuevo activo</button></div>
    <div class="nx-metrics"><article><small>Dispositivos</small><strong>${data.length}</strong></article><article><small>Asignados</small><strong>${data.filter(a=>a.state==='Asignado').length}</strong></article><article><small>Disponibles</small><strong>${data.filter(a=>a.state==='Disponible').length}</strong></article><article><small>En reparación</small><strong>${data.filter(a=>a.state==='En reparación').length}</strong></article></div>
    <section class="nx-panel"><div class="nx-panel-head nx-wrap"><h3>Inventario de dispositivos</h3><input class="nx-search" id="nxSearchAssets" value="${esc(el.dataset.query||'')}" placeholder="Buscar por serie, usuario, ubicación..." aria-label="Buscar activos"></div><div class="nx-table-wrap"><table class="nx-table"><thead><tr><th>Código</th><th>Equipo</th><th>Usuario</th><th>Ubicación</th><th>Estado</th><th>Ticket</th><th>Acciones</th></tr></thead><tbody>${filtered.map(a=>assetRow(a,ctx)).join('')||'<tr><td colspan="7">No hay resultados.</td></tr>'}</tbody></table></div></section><p class="nx-hint">Los activos de ejemplo no representan equipos reales. No guardes números de serie sensibles en esta demo.</p>`;
  }
  function assetForm(ctx, existing) {
    const a=existing||{id:'',kind:'Notebook',brand:'',serial:'',owner:'Sin asignar',location:'',state:'Disponible',ticketId:null};
    const overlay=document.createElement('div');overlay.className='nx-modal-wrap';overlay.innerHTML=`<div class="nx-modal" role="dialog" aria-modal="true" aria-labelledby="nxAssetTitle"><div class="nx-panel-head"><h3 id="nxAssetTitle">${existing?'Editar activo':'Nuevo activo'}</h3><button class="nx-mini-btn" type="button" id="nxCloseAsset">✕ Cerrar</button></div><form id="nxAssetForm" class="nx-form"><label>Tipo<select name="kind">${['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro'].map(v=>`<option ${v===a.kind?'selected':''}>${v}</option>`).join('')}</select></label><label>Modelo / descripción<input name="brand" required maxlength="100" value="${esc(a.brand)}"></label><label>N° serie (demo)<input name="serial" required maxlength="70" value="${esc(a.serial)}"></label><label>Usuario asignado<input name="owner" required maxlength="100" value="${esc(a.owner)}"></label><label>Ubicación<input name="location" required maxlength="100" value="${esc(a.location)}"></label><label>Estado<select name="state">${['Disponible','Asignado','En reparación','Baja'].map(v=>`<option ${v===a.state?'selected':''}>${v}</option>`).join('')}</select></label><label>Ticket relacionado<select name="ticketId"><option value="">Sin ticket</option>${ctx.tickets.map(t=>`<option value="${esc(t.id)}" ${String(a.ticketId)===String(t.id)?'selected':''}>#${esc(t.id)} · ${esc(t.title)}</option>`).join('')}</select></label><button type="submit" class="nx-cta">Guardar activo</button></form></div>`;
    document.body.append(overlay);
    overlay.querySelector('#nxCloseAsset').onclick=()=>overlay.remove();
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const list=assets();const serial=String(f.get('serial')).trim();if(list.some(x=>x.serial.toLowerCase()===serial.toLowerCase()&&x.id!==a.id)){notify(ctx,'Ya existe un activo con ese número de serie.');return;}
      const obj={id:a.id||`NX-A${String(Math.max(0,...list.map(x=>Number(String(x.id).replace('NX-A',''))||0))+1).padStart(3,'0')}`,kind:f.get('kind'),brand:String(f.get('brand')).trim(),serial,owner:String(f.get('owner')).trim(),location:String(f.get('location')).trim(),state:f.get('state'),ticketId:f.get('ticketId')?Number(f.get('ticketId')):null};if(existing){list.splice(list.findIndex(x=>x.id===a.id),1,obj);}else list.push(obj);
      if(write(ASSETS_KEY,list)){track(existing?'Activo actualizado':'Activo creado',`${obj.id} · ${obj.brand}`);overlay.remove();window.NexoV12.render('assets',ctx);notify(ctx,'Activo guardado correctamente.');}
    };
  }
  function guideCards(q='') { return guides.filter(g=>(g.title+' '+g.category).toLowerCase().includes(q.toLowerCase())).map(g=>`<button class="nx-guide" data-guide="${g.id}"><span class="nx-guide-icon">${g.icon}</span><small>${esc(g.category)}</small><b>${esc(g.title)}</b><span>Ver pasos →</span></button>`).join('')||empty('No encontramos un artículo con ese término.'); }
  function portalView(ctx, el, publicMode=false) {
    const total=ctx.tickets.length;
    el.innerHTML=`<div class="nx-hero nx-hero-portal"><div><span class="nx-kicker">NEXODESK PORTAL · AUTOSERVICIO</span><h2>¿En qué podemos ayudarte hoy?</h2><p>Encontrá respuestas rápidas o registrá una solicitud que se incorporará a la gestión de tickets.</p></div><div class="nx-portal-icon">⌂</div></div><section class="nx-panel"><div class="nx-panel-head"><h3>Centro de ayuda</h3><span>${guides.length} artículos</span></div><input id="nxGuideSearch" class="nx-search nx-search-full" type="search" placeholder="Buscar una solución: VPN, contraseña, impresora..." aria-label="Buscar artículos"><div class="nx-guide-grid" id="nxGuideGrid">${guideCards()}</div><div id="nxGuideDetail" class="nx-guide-detail" hidden></div></section><div class="nx-two-col"><section class="nx-panel"><h3>Registrar una solicitud</h3><p class="nx-hint">Describí el problema y el sistema creará un ticket en estado Registrado.</p><form class="nx-form" id="nxPortalForm"><label>Nombre del solicitante<input name="requester" required maxlength="90" placeholder="Ej. María López"></label><label>Tipo<select name="type"><option>Incidente</option><option>Requerimiento</option><option>Consulta</option></select></label><label>Asunto<input name="title" required maxlength="100" placeholder="Ej. Error al conectar VPN"></label><label>Descripción<textarea name="description" required maxlength="1500" rows="4" placeholder="¿Qué pasa? ¿Desde cuándo? ¿Qué intentaste?"></textarea></label><label>Prioridad<select name="priority"><option>Media</option><option>Alta</option><option>Baja</option></select></label><button type="submit" class="nx-cta">Enviar solicitud ↗</button><p id="portalStatus" class="nx-form-feedback" role="status" hidden></p></form></section><section class="nx-panel"><h3>Seguimiento de solicitudes</h3><p class="nx-hint">Consultá el estado con el número de ticket. Funciona solo en este navegador.</p><div class="nx-lookup"><input id="nxLookupId" type="number" placeholder="Ej. 10301" aria-label="Número de ticket"><button id="nxLookup" class="nx-mini-btn">Consultar</button></div><div id="nxLookupResult">${empty(`${total} tickets disponibles localmente`)}</div>${publicMode?'<a class="nx-minor-link" href="login.html">Acceso para técnicos y administradores →</a>':'<button class="nx-mini-btn" data-go-view="tickets">Ver gestión de tickets →</button>'}</section></div>`;
    el.querySelector('#nxGuideSearch').addEventListener('input',e=>{el.querySelector('#nxGuideGrid').innerHTML=guideCards(e.target.value);el.querySelector('#nxGuideDetail').hidden=true;});
    el.querySelector('#nxGuideGrid').addEventListener('click',e=>{const button=e.target.closest('[data-guide]');if(!button)return;const g=guides.find(x=>x.id===button.dataset.guide);const node=el.querySelector('#nxGuideDetail');node.innerHTML=`<h3>${esc(g.title)}</h3><ol>${g.details.map(d=>`<li>${esc(d)}</li>`).join('')}</ol>`;node.hidden=false;});
    el.querySelector('#nxLookup').addEventListener('click',()=>{const id=el.querySelector('#nxLookupId').value;if(publicMode)ctx.tickets=tickets();const t=ctx.tickets.find(t=>String(t.id)===String(id));el.querySelector('#nxLookupResult').innerHTML=t?`<div class="nx-lookup-result"><b>#${esc(t.id)} · ${esc(t.title)}</b><span>${badge(t.status)} ${badge(t.priority)}</span><small>Solicitante: ${esc(t.requester)}</small></div>`:empty('No se encontró ese ticket en este navegador.');});
    el.querySelector('#nxPortalForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const list=ctx.tickets;const id=Math.max(10300,...list.map(t=>Number(t.id)||0))+1;const item={id,title:String(f.get('title')).trim(),type:f.get('type'),priority:f.get('priority'),description:String(f.get('description')).trim(),requester:String(f.get('requester')).trim(),assignee:'Sin asignar',status:'Registrado',source:'Portal'};
      if(!item.title||!item.description||!item.requester)return;
      list.unshift(item);if(publicMode){if(!write(TICKETS_KEY,list))return;}else ctx.saveTickets();track('Solicitud desde Portal',`#${id} · ${item.title}`);e.target.reset();notify(ctx,`¡Solicitud #${id} creada! Ya aparece en Tickets, Kanban y Pulse.`);if(publicMode)ctx.tickets=tickets();else if(ctx.render)ctx.render(); // Mantener el mensaje visible en modo interno.
      if(!publicMode){const status=el.querySelector('#portalStatus');if(status){status.hidden=false;status.textContent=`Solicitud #${id} registrada. Podés consultarla desde Tickets.`;}}
    };
  }
  const viewRoot=()=>document.querySelector('#alternateView');
  let activeContext=null;
  const render=(view, ctx)=>{
    const el=viewRoot();if(!el)return;activeContext=ctx;
    if(view==='pulse')pulse(ctx,el);
    if(view==='assets')assetsView(ctx,el);
    if(view==='portal')portalView(ctx,el);
    el.onclick=e=>{
      const go=e.target.closest('[data-go-view]');if(go){window.dispatchEvent(new CustomEvent('nexodesk:open-view',{detail:go.dataset.goView}));return;}
      const ticket=e.target.closest('[data-ticket]');if(ticket){linkTicket(ticket.dataset.ticket,ctx);return;}
      if(e.target.closest('#nxAddAsset')){assetForm(ctx);return;}
      const edit=e.target.closest('[data-edit-asset]');if(edit){const a=assets().find(a=>a.id===edit.dataset.editAsset);if(a)assetForm(ctx,a);}
    };
    if(view==='assets'){
      el.oninput=e=>{if(e.target.id!=='nxSearchAssets')return;const pos=e.target.selectionStart;el.dataset.query=e.target.value;assetsView(ctx,el);const input=el.querySelector('#nxSearchAssets');input.focus();input.setSelectionRange(pos,pos);};
    } else el.oninput=null;
  };
  function initPublicPortal() {
    const root=document.querySelector('#publicPortalRoot');if(!root)return;
    const ctx={tickets:tickets(),showToast:null};
    portalView(ctx,root,true);
    window.addEventListener('storage',e=>{if(e.key===TICKETS_KEY)ctx.tickets=tickets();});
  }
  window.NexoV12={render,initPublicPortal,assets,activity};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPublicPortal);else initPublicPortal();
})();
