/* Pulse V2.5: una sola vista para Demo Local y API + PostgreSQL. */
(() => {
  'use strict';
  const states=new Map();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const count=v=>new Intl.NumberFormat('es-AR').format(Number(v)||0);
  const date=value=>value&&!Number.isNaN(new Date(value).getTime())?new Date(value).toLocaleString('es-AR'):'Fecha no documentada';
  const titles={created:'Ticket creado',updated:'Ticket actualizado',closed:'Ticket cerrado',reopened:'Ticket reabierto',
    diagnosis:'Diagnóstico de Triage',transfer:'Transferencia de Triage',local_activity:'Actividad Demo'};
  const fields={status:'Estado',priority:'Prioridad',assignee:'Responsable'};
  const source=()=>window.NexoAuth?.source==='api'?'api':'demo';
  function render(ctx,root){
    if(!root)return;
    if(window.NexoAuth?.isSelfService?.() || source()==='api'&&!['Administrador','Coordinador','Técnico'].includes(window.NexoAuth?.user?.role)){
      root.replaceChildren();return;
    }
    const mode=source(),key=mode==='api'?`api:${window.NexoAuth.user.id}`:'demo';
    if(!states.has(key))states.set(key,{summary:null,items:[],nextCursor:null,hasMore:false,filters:{from:'',to:''},busy:false,error:'',version:0});
    const s=states.get(key),adapter=window.NexoPulseData.create(mode,ctx);
    root.onclick=null;root.oninput=null;
    root.innerHTML=`<div class="nx-workspace nx-pulse-workspace" data-mode="${mode}">
      <div class="nx-hero"><div><span class="nx-kicker">PULSE · CENTRO DE OPERACIONES</span><h2>Una visión clara del soporte.</h2><p>Estadísticas operativas y actividad documentada de tickets y Triage.</p></div><span class="nx-pulse-symbol" aria-hidden="true">◉</span></div>
      <div class="nx-module-status" role="status" aria-live="polite" data-pulse-status><span></span><button id="pulseRefresh" type="button" class="nx-mini-btn">Actualizar Pulse</button></div>
      <form id="pulseFilters" class="nx-pulse-filters"><label>Desde (UTC)<input type="date" name="from" value="${esc(s.filters.from)}"></label><label>Hasta (UTC, inclusive)<input type="date" name="to" value="${esc(s.filters.to)}"></label><button class="nx-mini-btn" type="submit">Aplicar período</button><button class="nx-mini-btn" id="pulseClearFilters" type="button">Todo el período</button></form>
      <p class="nx-hint" data-pulse-scope></p>
      <div class="nx-metrics nx-pulse-metrics" id="pulseMetrics"></div>
      <div class="nx-two-col"><section class="nx-panel"><h3>Distribución por estado</h3><div id="pulseStates"></div></section><section class="nx-panel"><h3>Distribución por prioridad</h3><div id="pulsePriorities"></div></section></div>
      <div class="nx-two-col"><section class="nx-panel"><div class="nx-panel-head"><h3>Responsables actuales</h3><span id="pulseWorkloadScope"></span></div><p class="nx-hint">Agrupación por el responsable textual registrado en cada ticket. No establece una relación por ID de usuario.</p><div class="nx-table-wrap" tabindex="0" role="region" aria-label="Carga por responsable, desplazable horizontalmente"><table class="nx-table nx-pulse-table"><thead><tr><th>Responsable</th><th>Total</th><th>Abiertos</th><th>Cerrados</th></tr></thead><tbody id="pulseWorkload"></tbody></table></div></section>
      <section class="nx-panel"><h3>Escalamiento actual</h3><div class="nx-pulse-levels" id="pulseLevels"></div><p class="nx-hint">Cantidad de tickets del período cuyo expediente se encuentra actualmente en L2 o L3.</p><div class="nx-quick"><button type="button" data-pulse-view="triage">Abrir Triage <span>→</span></button><button type="button" data-pulse-view="assets">Abrir Assets <span>→</span></button><button type="button" data-pulse-view="dashboard">Abrir Kanban <span>→</span></button></div></section></div>
      <section class="nx-panel"><div class="nx-panel-head"><h3>Actividad reciente</h3><span data-pulse-feed-scope></span></div><p class="nx-hint">Orden de más reciente a más antiguo. El filtro se aplica a la fecha del evento, independientemente de cuándo se creó su ticket. No incluye contenido de notas internas.</p><ol class="nx-pulse-feed" id="pulseFeed"></ol><button type="button" class="nx-mini-btn" id="pulseLoadMore">Cargar más actividad</button></section></div>`;
    const workspace=root.firstElementChild;
    const live=()=>workspace.isConnected && root.firstElementChild===workspace && source()===mode &&
      !!document.querySelector('.nav-item[data-view="pulse"].active');
    function paint(){
      if(!live())return;
      const status=root.querySelector('[data-pulse-status]');
      status.dataset.state=s.error?'error':s.busy?'pending':'ready';
      status.querySelector('span').textContent=s.busy?'Cargando Pulse…':s.error||(mode==='api'?'API + PostgreSQL · Estadísticas calculadas por el servidor.':'Demo Local · Solo datos de este navegador.');
      root.querySelectorAll('#pulseFilters input,#pulseFilters button,#pulseRefresh').forEach(e=>e.disabled=s.busy);
      const more=root.querySelector('#pulseLoadMore');more.hidden=!s.hasMore;more.disabled=s.busy;
      root.querySelector('.nx-pulse-workspace').setAttribute('aria-busy',String(s.busy));
      const d=s.summary;
      root.querySelector('[data-pulse-scope]').textContent=d?
        `${mode==='api'?'Totales de todos los tickets almacenados':'Totales de los tickets locales'}${s.filters.from||s.filters.to?' creados en el período UTC elegido':' · sin filtro de creación'}. ${mode==='api'?'Calculado en el servidor':'Calculado en este navegador'}: ${date(d.generatedAt)}.${mode==='demo'&&d.scope?.undatedTickets?` ${count(d.scope.undatedTickets)} ticket(s) sin fecha documentada${s.filters.from||s.filters.to?'; quedan fuera del filtro de fechas':'; se incluyen al mostrar todo el período'}.`:''}`:
        s.error?'No hay estadísticas confirmadas para este período.':s.busy?'Consultando estadísticas…':'Sin estadísticas disponibles.';
      const metrics=[['Abiertos','open','Todos los estados excepto Cerrado'],['En atención','inProgress','Atención en curso'],['Pendientes de validación','validation','Estado Validación'],['Cerrados','closed','Estado Cerrado'],['Sin asignar','unassigned','Solo tickets abiertos'],['Total de tickets','total','Cohorte completa del período']];
      root.querySelector('#pulseMetrics').innerHTML=metrics.map(([label,field,hint])=>`<article><small>${label}</small><strong>${d?count(d.totals[field]):'—'}</strong><span>${hint}</span></article>`).join('');
      function bars(items,key){
        if(!d)return '<p class="nx-empty">Sin datos confirmados.</p>';
        return items.map(item=>{const total=Number(d.totals.total)||0,n=Number(item.count)||0,ratio=total?Math.min(100,n/total*100):0;
          return `<div class="nx-bar-row"><span>${esc(item[key])}</span><div class="nx-progress" aria-hidden="true"><i style="width:${ratio}%"></i></div><b>${count(n)}</b></div>`;}).join('')||'<p class="nx-empty">Sin registros para este período.</p>';
      }
      root.querySelector('#pulseStates').innerHTML=bars(d?.byStatus||[],'status');
      root.querySelector('#pulsePriorities').innerHTML=bars(d?.byPriority||[],'priority');
      root.querySelector('#pulseWorkloadScope').textContent=d?`${count(d.workload.length)} de ${count(d.totalWorkloadGroups)} responsables · máximo ${count(d.workloadLimit)}`:'';
      root.querySelector('#pulseWorkload').innerHTML=d?.workload?.length?d.workload.map(g=>`<tr><td>${esc(g.assignee)}</td><td>${count(g.total)}</td><td>${count(g.open)}</td><td>${count(g.closed)}</td></tr>`).join(''):'<tr><td colspan="4">Sin responsables registrados para este período.</td></tr>';
      root.querySelector('#pulseLevels').innerHTML=['l2','l3'].map(level=>`<article><span>${level.toUpperCase()}</span><strong>${d?count(d.escalated[level]):'—'}</strong></article>`).join('');
      root.querySelector('[data-pulse-feed-scope]').textContent=`${count(s.items.length)} evento(s) cargados${s.hasMore?' · hay más resultados':''}`;
      root.querySelector('#pulseFeed').innerHTML=s.items.map(item=>{
        const changes=Object.entries(item.changes||{}).filter(([k])=>Object.hasOwn(fields,k));
        const detail=changes.map(([k,c])=>`${fields[k]}: ${c?.old??'Sin dato'} → ${c?.new??'Sin dato'}`).join(' · ');
        const transition=item.kind==='transfer'&&item.fromLevel!=null&&item.toLevel!=null?` · L${item.fromLevel} → L${item.toLevel}`:'';
        return `<li class="nx-pulse-event" data-pulse-event-id="${esc(item.id)}"><div class="nx-pulse-event-mark" aria-hidden="true">${item.kind==='transfer'?'↑':item.kind==='closed'?'✓':'•'}</div><div><h4>${esc(titles[item.kind]||'Actividad registrada')}${esc(transition)}</h4>${item.ticketId!=null?`<button type="button" class="nx-text-btn" data-pulse-ticket="${esc(item.ticketId)}">#${esc(item.ticketId)} · ${esc(item.title)}</button>`:`<p>${esc(item.title)}</p>`}<p class="nx-pulse-meta">${esc(item.actorName||'Autor no documentado')} · ${esc(item.occurredAt?date(item.occurredAt):item.recordedDate?'Fecha original: '+item.recordedDate+' · sin fecha comparable':'Fecha no documentada')}</p>${detail?`<p class="nx-pulse-changes">${esc(detail)}</p>`:''}</div></li>`;
      }).join('')||`<li class="nx-empty">${s.busy?'Consultando actividad…':s.error?'No hay actividad confirmada para mostrar.':'No hay actividad documentada para este período.'}</li>`;
    }
    s.paint=paint;
    async function refresh(){
      if(s.busy)return;
      const version=++s.version;s.busy=true;s.error='';s.summary=null;s.items=[];s.nextCursor=null;s.hasMore=false;paint();
      try{
        const [summary,feed]=await Promise.all([adapter.summary(s.filters),adapter.activity(s.filters)]);
        if(version!==s.version)return;
        if(!summary || !Array.isArray(feed.data))throw Error('El servidor devolvió datos de Pulse inválidos.');
        s.summary=summary;s.items=feed.data;s.nextCursor=feed.nextCursor;s.hasMore=!!feed.hasMore;
      }catch(error){if(version===s.version)s.error=error.message||'No se pudo cargar Pulse.';}
      finally{if(version===s.version)s.busy=false;s.paint?.();}
    }
    root.querySelector('#pulseRefresh').addEventListener('click',()=>void refresh());
    root.querySelector('#pulseFilters').addEventListener('submit',event=>{
      event.preventDefault();if(s.busy)return;
      const form=event.target,from=form.elements.from.value,to=form.elements.to.value;
      if(from&&to&&from>to){s.error='La fecha Desde no puede ser posterior a Hasta.';paint();return;}
      s.filters={from,to};void refresh();
    });
    root.querySelector('#pulseClearFilters').addEventListener('click',()=>{
      if(s.busy)return;s.filters={from:'',to:''};root.querySelector('#pulseFilters').reset();
      root.querySelector('#pulseFilters').elements.from.value='';root.querySelector('#pulseFilters').elements.to.value='';void refresh();
    });
    root.querySelector('#pulseLoadMore').addEventListener('click',async()=>{
      if(s.busy||!s.hasMore)return;
      const version=++s.version;s.busy=true;s.error='';paint();
      try{const feed=await adapter.activity(s.filters,s.nextCursor);if(version!==s.version)return;
        if(!Array.isArray(feed.data))throw Error('El servidor devolvió una página inválida.');
        const seen=new Set(s.items.map(i=>String(i.id)));s.items.push(...feed.data.filter(i=>!seen.has(String(i.id))));
        s.nextCursor=feed.nextCursor;s.hasMore=!!feed.hasMore;
      }catch(error){if(version===s.version)s.error=error.message||'No se pudo cargar más actividad.';}
      finally{if(version===s.version)s.busy=false;s.paint?.();}
    });
    root.onclick=event=>{
      if(!live())return;
      const ticket=event.target.closest('[data-pulse-ticket]');if(ticket){ctx.openTicket?.(ticket.dataset.pulseTicket);return;}
      const view=event.target.closest('[data-pulse-view]');if(view)window.dispatchEvent(new CustomEvent('nexodesk:open-view',{detail:view.dataset.pulseView}));
    };
    paint();if(!s.busy)void refresh();
  }
  window.NexoPulse={render};
})();
