/* Una vista compartida para el asistente API y Demo. */
(() => {
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('es-AR'):'Fecha no documentada';
 const modeNow=()=>window.NexoAuth?.source==='api'?'api':'demo';
 function mount({ticketId,root,dialog,ctx={}}){
  if(!root||window.NexoAuth?.isSelfService?.())return;
  const mode=modeNow(),stamp={},adapter=window.NexoIntelligenceData.create(mode,ctx);
  root._intelligenceStamp=stamp;
  root.innerHTML=`<section class="intel-assistant" aria-labelledby="intelHeading-${esc(ticketId)}"><div class="intel-assistant-head"><div><span class="intel-assistant-kicker">INTELLIGENCE · ASISTENCIA TÉCNICA</span><h3 id="intelHeading-${esc(ticketId)}">Diagnóstico orientativo</h3></div><button type="button" class="nx-mini-btn" data-intelligence-analyze>Analizar ticket</button></div><p class="intel-assistant-hint">Las sugerencias requieren revisión humana. Aceptar registra tu decisión; no modifica el ticket, no ejecuta comandos ni escala el caso.</p><p role="status" aria-live="polite" data-intelligence-status data-state="pending">Consultando disponibilidad e historial…</p><div data-intelligence-history></div></section>`;
  const state={items:[],busy:false,error:'',provider:null,uncertain:false};
  const live=()=>root.isConnected&&root._intelligenceStamp===stamp&&modeNow()===mode&&(!dialog||dialog.open);
  function paint(){
   if(!live())return;
   const status=root.querySelector('[data-intelligence-status]');
   status.dataset.state=state.error?'error':state.busy?'pending':'ready';
   status.textContent=state.busy?'Consultando o guardando Intelligence…':state.error||`${mode==='demo'?'Demo Local':'API + PostgreSQL'} · Proveedor disponible: ${state.provider?.provider==='openai'?'OpenAI (con límites; puede usar motor local ante errores)':'motor local determinístico'}.`;
   root.querySelector('[data-intelligence-analyze]').disabled=state.busy||state.uncertain;
   root.querySelector('[data-intelligence-history]').innerHTML=state.items.length?state.items.map(item=>{
    const p=item.payload||{},labels={pending:'Pendiente de revisión',accepted:'Aceptada por personal IT',discarded:'Descartada por personal IT'};
    return `<article class="intel-suggestion" data-intelligence-id="${esc(item.id)}"><header><strong>${item.provider==='openai'?'Sugerencia generada por IA':'Sugerencia del motor local'}</strong><span>${esc(date(item.createdAt))}</span></header><p>${esc(p.analysis)}</p>${p.fallbackReason?'<p class="intel-assistant-hint">Se utilizó el motor local por indisponibilidad o límite del proveedor externo.</p>':''}${[['Causas posibles','causes'],['Pruebas propuestas','tests'],['Procedimiento orientativo','procedures']].map(([label,key])=>`<h4>${label}</h4><ul>${(p[key]||[]).map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`).join('')}<details><summary>Antecedentes documentados (${(p.antecedents||[]).length})</summary>${(p.antecedents||[]).map(a=>`<div class="intel-antecedent"><button type="button" class="nx-text-btn" data-intelligence-ticket="${esc(a.id)}">#${esc(a.id)} · ${esc(a.title)}</button><p>${esc(a.status)}</p><p>${esc(a.diagnosis||'Sin diagnóstico documentado.')}</p></div>`).join('')||'<p>Sin antecedentes coincidentes documentados.</p>'}</details><p class="intel-assistant-hint">${esc(p.notice||'Sugerencia no verificada.')}</p><div class="intel-suggestion-actions"><span>${esc(labels[item.decision]||'Estado desconocido')}</span>${item.decision==='pending'?`<button type="button" class="nx-mini-btn" data-intelligence-decision="accepted" data-suggestion="${esc(item.id)}" ${state.busy||state.uncertain?'disabled':''}>Aceptar orientación</button><button type="button" class="nx-mini-btn" data-intelligence-decision="discarded" data-suggestion="${esc(item.id)}" ${state.busy||state.uncertain?'disabled':''}>Descartar</button>`:''}</div></article>`;
   }).join(''):'<p class="intel-assistant-hint">Todavía no hay sugerencias. Analizar genera una orientación para este ticket. Podés ignorarla sin realizar ninguna acción.</p>';
   root.querySelectorAll('[data-intelligence-ticket]').forEach(b=>b.onclick=()=>ctx.openTicket?.(b.dataset.intelligenceTicket));
   root.querySelectorAll('[data-intelligence-decision]').forEach(b=>b.onclick=()=>void write(()=>adapter.decide(b.dataset.suggestion,b.dataset.intelligenceDecision)));
  }
  async function write(action){
   if(state.busy||state.uncertain)return;state.busy=true;state.error='';paint();
   try{const item=await action();if(!live())return;state.items=[item,...state.items.filter(i=>String(i.id)!==String(item.id))].slice(0,10);}
   catch(error){if(live()){state.uncertain=mode==='api'&&(!error.status||error.status>=500);state.error=(error.message||'No se pudo completar la operación.')+(state.uncertain?' Cerrá y reabrí la ficha para confirmar el resultado antes de reintentar.':'');}}
   finally{state.busy=false;paint();}
  }
  root.querySelector('[data-intelligence-analyze]').onclick=()=>void write(()=>adapter.analyze(ticketId));
  void(async()=>{state.busy=true;paint();try{const [provider,items]=await Promise.all([adapter.status(),adapter.history(ticketId)]);if(live()){state.provider=provider;state.items=items;}}catch(error){if(live())state.error=error.message||'No se pudo cargar Intelligence.';}finally{state.busy=false;paint();}})();
 }
 function render(ctx,providedRoot){
  const root=providedRoot||document.querySelector('#alternateView');if(!root||window.NexoAuth?.isSelfService?.())return;
  root.innerHTML=`<section class="nx-workspace intel-module"><div class="nx-hero"><div><span class="nx-kicker">NEXODESK INTELLIGENCE</span><h2>Diagnóstico con antecedentes.</h2><p>Asistencia orientativa para personal IT. Los antecedentes se consultan en el origen seleccionado.</p></div></div><label>Seleccionar entre los tickets cargados<select id="intelligenceSelected">${(ctx.tickets||[]).map(t=>`<option value="${esc(t.id)}">#${esc(t.id)} · ${esc(t.title)}</option>`).join('')}</select></label><div id="intelligencePanel"></div></section>`;
  const select=root.querySelector('#intelligenceSelected');const show=()=>{if(select.value)mount({ticketId:select.value,root:root.querySelector('#intelligencePanel'),ctx});else root.querySelector('#intelligencePanel').textContent='Sin tickets cargados para analizar.';};select.onchange=show;show();
 }
 window.NexoIntelligence={mount,render};
})();
