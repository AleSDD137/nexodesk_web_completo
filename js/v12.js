/* NEXODESK: datos demo compartidos, Pulse y entrada a las vistas unificadas. */
(() => {
  'use strict';
  const ASSETS_KEY = 'nexodesk-demo-assets-v12';
  const ACTIVITY_KEY = 'nexodesk-demo-activity-v12';
  const seedAssets = [
    {id:'NX-A001',kind:'Notebook',brand:'HP ProBook 450',serial:'HP-45-DEMO',owner:'María López',location:'Oficina central',state:'Asignado',ticketId:10301},
    {id:'NX-A002',kind:'Tablet',brand:'Samsung Tab A9',serial:'SM-A9-DEMO',owner:'Juan Pérez',location:'Campo Norte',state:'Asignado',ticketId:null},
    {id:'NX-A003',kind:'Notebook',brand:'Dell Latitude 5420',serial:'DL-54-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null},
    {id:'NX-A004',kind:'Teléfono',brand:'Samsung Galaxy A55',serial:'SM-55-DEMO',owner:'Lucía Torres',location:'Oficina central',state:'En reparación',ticketId:10294},
    {id:'NX-A005',kind:'Monitor',brand:'HP E233',serial:'HP-E233-DEMO',owner:'Sofía Díaz',location:'Campo Sur',state:'Asignado',ticketId:null},
    {id:'NX-A006',kind:'Tablet',brand:'Apple iPad 9',serial:'AP-IP9-DEMO',owner:'Sin asignar',location:'Depósito IT',state:'Disponible',ticketId:null}
  ];
  const clone = v => JSON.parse(JSON.stringify(v));
  const read = (key, fallback) => { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : clone(fallback); } catch { return clone(fallback); } };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const assets = () => read(ASSETS_KEY, seedAssets);
  const activity = () => read(ACTIVITY_KEY, []);
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
  const render=(view, ctx)=>{
    const el=document.querySelector('#alternateView');if(!el)return;
    el.onclick=null;el.oninput=null;
    if(view==='assets'){window.NexoAssets.render(ctx,el);return;}
    if(view==='portal'){window.NexoPortal.render(ctx,el);return;}
    if(view==='pulse')pulse(ctx,el);
    el.onclick=e=>{
      const go=e.target.closest('[data-go-view]');if(go){window.dispatchEvent(new CustomEvent('nexodesk:open-view',{detail:go.dataset.goView}));return;}
      const ticket=e.target.closest('[data-ticket]');if(ticket)linkTicket(ticket.dataset.ticket,ctx);
    };
  };
  function initPublicPortal() {
    const root=document.querySelector('#publicPortalRoot');if(!root)return;
    window.NexoPortal.render({tickets:[],showToast:null},root,{publicMode:true});
  }
  window.NexoV12={render,initPublicPortal,assets,activity};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initPublicPortal);else initPublicPortal();
})();
