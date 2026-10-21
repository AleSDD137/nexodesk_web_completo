/* NEXODESK V1.3 · Relaciones IT. Solo frontend / almacenamiento local de demo. */
(() => {
  'use strict';
  const EXTRA_KEY='nexodesk-demo-asset-links-v13';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-AR');
  const getExtras=()=>{try{const x=JSON.parse(localStorage.getItem(EXTRA_KEY)||'{}');return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
  const setExtras=x=>{try{localStorage.setItem(EXTRA_KEY,JSON.stringify(x));return true;}catch{return false;}};
  const getAssets=()=>window.NexoV12?.assets?.()||[];
  const getLinks=(asset,extras)=>[...new Set([asset.ticketId,...(Array.isArray(extras[asset.id])?extras[asset.id]:[])].filter(x=>x!==null&&x!==''&&x!==undefined).map(String))];
  const filterKinds=['Todos','Usuarios','Equipos','Tickets'];
  let state={search:'',kind:'Todos',selection:null,showClosed:true};
  let activeCtx=null;
  const k=(kind,id)=>kind+':'+id;
  function model(ctx){
    const assets=getAssets(),extras=getExtras(),tickets=ctx.tickets||[],users=ctx.users||[];
    const nodes=new Map(),edges=[];
    const put=(kind,id,label,sub,meta={})=>{const key=k(kind,id);if(!nodes.has(key))nodes.set(key,{key,id:String(id),kind,label:String(label),sub:String(sub||''),meta});return key;};
    const edge=(a,b,type)=>{if(a===b)return;if(!edges.some(e=>e.a===a&&e.b===b&&e.type===type))edges.push({a,b,type});};
    const nameKey=name=>norm(name)&&norm(name)!=='sin asignar'?put('usuario',norm(name),name,'Persona relacionada'):null;
    for(const u of users){if(!u.active)continue;nameKey(u.name);}
    for(const a of assets){const ak=put('equipo',a.id,a.brand,a.id+' · '+a.state,{asset:a});const owner=nameKey(a.owner);if(owner)edge(owner,ak,'Asignado a');}
    for(const t of tickets){const tk=put('ticket',t.id,'#'+t.id+' · '+t.title,t.status+' · '+t.priority,{ticket:t});const requester=nameKey(t.requester);if(requester)edge(requester,tk,'Solicitado por');const assignee=nameKey(t.assignee);if(assignee)edge(assignee,tk,'Atendido por');}
    for(const a of assets){for(const tid of getLinks(a,extras)){if(nodes.has(k('ticket',tid)))edge(k('equipo',a.id),k('ticket',tid),'Vínculo confirmado');}}
    return {nodes,edges,assets,tickets,extras};
  }
  const assetTickets=(m,id)=>m.edges.filter(e=>e.type==='Vínculo confirmado'&&e.a===k('equipo',id)).map(e=>m.nodes.get(e.b)).filter(Boolean);
  function filtered(m){
    const allowed=new Set([...m.nodes.values()].filter(n=>state.showClosed||n.kind!=='ticket'||n.meta.ticket?.status!=='Cerrado').map(n=>n.key));
    let keys=new Set(allowed);
    if(state.search.trim()){const q=norm(state.search),matches=new Set([...m.nodes.values()].filter(n=>allowed.has(n.key)&&norm([n.label,n.sub,n.id,n.meta.asset?.serial,n.meta.asset?.owner,n.meta.asset?.location,n.meta.ticket?.requester,n.meta.ticket?.assignee].join(' ')).includes(q)).map(n=>n.key));keys=new Set(matches);for(const e of m.edges){if(matches.has(e.a)&&allowed.has(e.b))keys.add(e.b);if(matches.has(e.b)&&allowed.has(e.a))keys.add(e.a);}}
    if(state.kind!=='Todos'){const kind={Usuarios:'usuario',Equipos:'equipo',Tickets:'ticket'}[state.kind];const matches=new Set([...keys].filter(key=>m.nodes.get(key)?.kind===kind));if(matches.size){for(const e of m.edges){if(matches.has(e.a)&&allowed.has(e.b))matches.add(e.b);if(matches.has(e.b)&&allowed.has(e.a))matches.add(e.a);}keys=matches;}else keys=new Set();}
    return {nodes:[...keys].map(key=>m.nodes.get(key)).filter(Boolean),edges:m.edges.filter(e=>keys.has(e.a)&&keys.has(e.b))};
  }
  function layout(graph){
    const groups={usuario:[],equipo:[],ticket:[]};graph.nodes.forEach(n=>groups[n.kind].push(n));
    for(const kind of Object.keys(groups))groups[kind].sort((a,b)=>a.label.localeCompare(b.label,'es'));
    const biggest=Math.max(1,...Object.values(groups).map(a=>a.length));
    const height=Math.max(380,biggest*77+74),width=1100,coordinates=new Map();
    const positions={usuario:150,equipo:550,ticket:950};
    Object.entries(groups).forEach(([kind,items])=>items.forEach((n,i)=>coordinates.set(n.key,{x:positions[kind],y:height/2+(i-(items.length-1)/2)*77})));
    return {coordinates,width,height,groups};
  }
  function graphSvg(graph){
    if(!graph.nodes.length)return '<div class="rel-empty">Sin resultados. Probá otro filtro o agregá un activo/ticket.</div>';
    const {coordinates,width,height}=layout(graph);
    const lines=graph.edges.map(e=>{const a=coordinates.get(e.a),b=coordinates.get(e.b);if(!a||!b)return '';const confirmed=e.type==='Vínculo confirmado';return `<path d="M ${a.x} ${a.y} C ${(a.x+b.x)/2} ${a.y}, ${(a.x+b.x)/2} ${b.y}, ${b.x} ${b.y}" class="rel-edge ${confirmed?'rel-confirmed':''}" aria-label="${esc(e.type)}"><title>${esc(e.type)}</title></path>`;}).join('');
    const icons={usuario:'U',equipo:'E',ticket:'T'};
    const elems=graph.nodes.map(n=>{const p=coordinates.get(n.key);const selected=state.selection===n.key;const label=n.label.length>32?n.label.slice(0,29)+'…':n.label;return `<g class="rel-node rel-${n.kind} ${selected?'is-selected':''}" data-node="${esc(n.key)}" role="button" tabindex="0" aria-label="Ver ${esc(n.kind)} ${esc(n.label)}" transform="translate(${p.x},${p.y})"><rect x="-133" y="-28" width="266" height="56" rx="12"/><circle cx="-109" cy="0" r="15"/><text x="-109" y="4" class="rel-icon" text-anchor="middle">${icons[n.kind]}</text><text x="-85" y="-3" class="rel-label">${esc(label)}</text><text x="-85" y="13" class="rel-sub">${esc(n.sub.length>38?n.sub.slice(0,35)+'…':n.sub)}</text><title>${esc(n.label)}</title></g>`;}).join('');
    return `<svg class="rel-svg" viewBox="0 0 ${width} ${height}" style="min-width:900px;min-height:${Math.min(height,700)}px" role="group" aria-label="Diagrama de relaciones de usuarios, equipos y tickets"><g>${lines}</g><g>${elems}</g></svg>`;
  }
  function detail(m,ctx){
    const node=m.nodes.get(state.selection);if(!node)return '<div class="rel-placeholder"><span>◎</span><h3>Explorá las relaciones</h3><p>Seleccioná un nodo del mapa para ver información, conexiones y acciones.</p></div>';
    const connected=m.edges.filter(e=>e.a===node.key||e.b===node.key).map(e=>({edge:e,other:m.nodes.get(e.a===node.key?e.b:e.a)})).filter(x=>x.other);
    const basics=node.kind==='equipo'?`<dl><dt>Código</dt><dd>${esc(node.id)}</dd><dt>Serie demo</dt><dd>${esc(node.meta.asset.serial)}</dd><dt>Ubicación</dt><dd>${esc(node.meta.asset.location)}</dd><dt>Estado</dt><dd>${esc(node.meta.asset.state)}</dd></dl>`:node.kind==='ticket'?`<dl><dt>Prioridad</dt><dd>${esc(node.meta.ticket.priority)}</dd><dt>Estado</dt><dd>${esc(node.meta.ticket.status)}</dd><dt>Solicitante</dt><dd>${esc(node.meta.ticket.requester)}</dd><dt>Responsable</dt><dd>${esc(node.meta.ticket.assignee)}</dd></dl>`:'';
    const related=connected.map(({edge,other})=>`<button type="button" class="rel-related" data-select-node="${esc(other.key)}"><span><small>${esc(edge.type)} · ${esc(other.kind)}</small><b>${esc(other.label)}</b></span><span>↗</span></button>`).join('')||'<p class="rel-note">Todavía no hay conexiones para este elemento.</p>';
    const attached=node.kind==='equipo'?assetTickets(m,node.id):[];
    const choices=node.kind==='equipo'?m.tickets.filter(t=>!getLinks(node.meta.asset,m.extras).includes(String(t.id))).map(t=>`<option value="${esc(t.id)}">#${esc(t.id)} · ${esc(t.title)}</option>`).join(''):'';
    return `<div class="rel-detail-header"><span class="rel-kicker">${esc(node.kind.toUpperCase())}</span><h3>${esc(node.label)}</h3><p>${esc(node.sub)}</p></div>${basics}<h4>Conexiones (${connected.length})</h4><div class="rel-related-list">${related}</div>${node.kind==='ticket'?`<button type="button" class="nx-cta rel-action" data-open-ticket="${esc(node.id)}">Abrir ticket #${esc(node.id)} ↗</button>`:''}${node.kind==='equipo'?`<div class="rel-link-form"><h4>Vincular otro ticket</h4><p class="rel-note">Vínculos confirmados manualmente en esta demo: ${attached.length}. Un equipo con 2 o más tickets tiene incidentes repetidos registrados.</p>${choices?`<form id="relAttachForm"><select name="ticket" required aria-label="Seleccionar ticket"><option value="">Elegí un ticket...</option>${choices}</select><button class="nx-cta" type="submit">Vincular</button></form>`:'<p class="rel-note">Todos los tickets disponibles están vinculados.</p>'}${attached.length?`<h4>Tickets vinculados</h4>${attached.map(t=>`<div class="rel-attached"><span>#${esc(t.id)} · ${esc(t.meta.ticket.title)}</span>${String(node.meta.asset.ticketId)===t.id?'<small>Vínculo original · editar en Assets</small>':`<button class="rel-remove" data-unlink="${esc(t.id)}">Quitar</button>`}</div>`).join('')}`:''}</div>`:''}`;
  }
  function paint(ctx){
    const root=document.querySelector('#alternateView');if(!root)return;
    const m=model(ctx),graph=filtered(m);
    if(state.selection&&!m.nodes.has(state.selection))state.selection=null;
    const repeats=m.assets.map(a=>({asset:a,count:assetTickets(m,a.id).length})).filter(x=>x.count>=2).sort((a,b)=>b.count-a.count);
    const without=m.assets.filter(a=>assetTickets(m,a.id).length===0).length;
    root.innerHTML=`<section class="rel-hero"><div><span class="rel-kicker">NEXODESK V1.3 · MAPA DE RELACIONES</span><h2>Conectá los puntos. Encontrá la causa.</h2><p>Visualizá vínculos entre personas, dispositivos y solicitudes. Identificá equipos con múltiples tickets relacionados, sin salir del dashboard.</p></div><span class="rel-hero-ornament" aria-hidden="true">⬡</span></section>
    <div class="rel-metrics"><article><span>Usuarios relacionados</span><strong>${[...m.nodes.values()].filter(n=>n.kind==='usuario').length}</strong></article><article><span>Equipos</span><strong>${m.assets.length}</strong></article><article><span>Tickets</span><strong>${m.tickets.length}</strong></article><article class="rel-alert"><span>Equipos con 2+ tickets</span><strong>${repeats.length}</strong></article></div>
    <section class="rel-surface"><div class="rel-toolbar"><label>Buscar conexiones<input id="relSearch" type="search" placeholder="Usuario, ticket, equipo, serie..." value="${esc(state.search)}" autocomplete="off"></label><label>Explorar<select id="relKind">${filterKinds.map(v=>`<option ${state.kind===v?'selected':''}>${v}</option>`).join('')}</select></label><label class="rel-check"><input id="relShowClosed" type="checkbox" ${state.showClosed?'checked':''}> Mostrar tickets cerrados</label><button type="button" class="rel-reset" id="relReset">Limpiar filtros</button></div>
    <div class="rel-workspace"><section class="rel-canvas-wrap"><div class="rel-column-hints"><span>PERSONAS</span><span>DISPOSITIVOS</span><span>TICKETS</span></div><div class="rel-canvas" id="relCanvas">${graphSvg(graph)}</div><p class="rel-legend"><span class="rel-line-strong"></span> Relación explícita de activo–ticket <span class="rel-line-soft"></span> Relación por coincidencia exacta de nombre</p><p class="rel-note">La ubicación de nodos es ilustrativa. No se infieren relaciones de equipos a partir de coincidencias de texto: esos vínculos se registran manualmente.</p></section><aside class="rel-inspector" id="relInspector">${detail(m,ctx)}</aside></div></section>
    <section class="rel-insights"><div class="rel-insight-title"><h3>Dispositivos con incidentes repetidos</h3><span>${repeats.length} detectados · ${without} sin ticket vinculado</span></div>${repeats.length?repeats.map(({asset,count})=>`<button type="button" data-select-node="${esc(k('equipo',asset.id))}" class="rel-issue"><span class="rel-issue-count">${count}</span><span><b>${esc(asset.brand)}</b><small>${esc(asset.id)} · ${esc(asset.owner)} · ${esc(asset.location)}</small></span><span class="rel-view">Ver conexiones →</span></button>`).join(''):'<div class="rel-no-repeats">Aún no hay equipos con dos o más tickets vinculados. Seleccioná un equipo y vinculá otro ticket para probar esta función.</div>'}</section>
    <p class="rel-disclaimer">Prototipo local: las relaciones de personas se forman por coincidencias exactas de nombre, no por ID de identidad. Antes del backend, no representa un inventario corporativo validado.</p>`;
    root.querySelector('#relSearch').addEventListener('input',e=>{const val=e.target.value;state.search=val;paint(ctx);const el=root.querySelector('#relSearch');el.focus();el.setSelectionRange(val.length,val.length);});
    root.querySelector('#relKind').addEventListener('change',e=>{state.kind=e.target.value;paint(ctx);});
    root.querySelector('#relShowClosed').addEventListener('change',e=>{state.showClosed=e.target.checked;paint(ctx);});
    root.querySelector('#relReset').addEventListener('click',()=>{state.search='';state.kind='Todos';state.showClosed=true;paint(ctx);});
    root.querySelectorAll('[data-node],[data-select-node]').forEach(el=>{
      const pick=()=>{state.selection=el.dataset.node||el.dataset.selectNode;paint(ctx);};el.addEventListener('click',pick);if(el.hasAttribute('tabindex'))el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
    });
    root.querySelector('[data-open-ticket]')?.addEventListener('click',e=>ctx.openTicket(e.currentTarget.dataset.openTicket));
    root.querySelector('#relAttachForm')?.addEventListener('submit',e=>{e.preventDefault();const node=m.nodes.get(state.selection);if(!node||node.kind!=='equipo')return;const id=String(new FormData(e.currentTarget).get('ticket'));if(!m.tickets.some(t=>String(t.id)===id))return;const extras=getExtras(),cur=getLinks(node.meta.asset,extras);if(cur.includes(id))return;extras[node.id]=[...new Set([...(Array.isArray(extras[node.id])?extras[node.id]:[]).map(String),id])];if(!setExtras(extras)){ctx.showToast('No se pudo guardar el vínculo.');return;}ctx.showToast(`Ticket #${id} relacionado con ${node.id}.`);paint(ctx);});
    root.querySelectorAll('[data-unlink]').forEach(el=>el.addEventListener('click',()=>{const node=m.nodes.get(state.selection),id=el.dataset.unlink;if(!node||node.kind!=='equipo')return;const extras=getExtras();extras[node.id]=(extras[node.id]||[]).filter(x=>String(x)!==id);if(!setExtras(extras)){ctx.showToast('No se pudo guardar el cambio.');return;}ctx.showToast('Vínculo eliminado.');paint(ctx);}));
  }
  window.NexoV13={render(ctx){activeCtx=ctx;paint(ctx);}};
  window.addEventListener('storage',e=>{if(activeCtx&&[EXTRA_KEY,'nexodesk-demo-assets-v12'].includes(e.key)&&document.querySelector('.rel-surface'))paint(activeCtx);});
})();
