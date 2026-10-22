/* Triage compartido: una vista oscura para demo y API, sin acceso directo al almacenamiento. */
(() => {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const source = () => window.NexoAuth?.source === 'api' ? 'api' : 'demo';
  const options = (values, current) => values.map(x => `<option value="${esc(x)}" ${String(current) === String(x) ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const date = value => value ? new Date(value).toLocaleString('es-AR') : '';
  const states = new Map();
  let generation = 0, currentContext;
  const active = mode => source() === mode && !!document.querySelector('.nav-item[data-view="triage"].active');
  const guidance = [
    {name:'Redes y VPN', words:['vpn','anyconnect','wifi','red','internet'], steps:['Verificar conectividad local','Registrar código de error sin contraseñas','Comprobar si hay otros usuarios afectados']},
    {name:'Cuentas y permisos', words:['erp','acceso','contraseña','clave','cuenta','login'], steps:['Identificar sistema y error exacto','Verificar estado de la cuenta por procedimiento autorizado','Revisar permisos o escalar al responsable']},
    {name:'Instalación de software', words:['software','instalación','licencia','aplicación'], steps:['Confirmar versión y licencia','Revisar compatibilidad del equipo','Documentar error e instalación']},
    {name:'Hardware', words:['notebook','equipo','monitor','hardware','batería'], steps:['Registrar activo y ubicación','Comprobar conexiones y síntomas','Consultar historial en Assets']},
    {name:'Correo', words:['outlook','correo','email'], steps:['Registrar mensaje exacto','Verificar conectividad','Determinar alcance']},
    {name:'Impresión', words:['impresora','imprimir','impresión'], steps:['Identificar impresora','Verificar cola y conexión','Documentar prueba de impresión']}
  ];
  function stateFor(mode) {
    if (!states.has(mode)) states.set(mode, {selected:null, query:'', filter:'abiertos', index:{}, people:[], record:null,
      loading:false, busy:false, dirty:false, draft:null, error:'', notice:'', requiresReload:false});
    return states.get(mode);
  }
  function detail(t, r, s, adapter) {
    const d = s.draft?.diagnosis || {...r, newTest:'', applyPriority:false};
    const h = s.draft?.transfer || {toLevel:r.level === 'L3' ? 2 : Number(r.level.slice(1)) + 1, assigneeUserId:'', reason:'', pending:''};
    const tips = guidance.map(g => ({...g, found:g.words.filter(w => clean(t.title + ' ' + t.description).includes(clean(w)))}))
      .filter(g => g.found.length).sort((a,b) => b.found.length - a.found.length).slice(0,2);
    return `<div class="tr-head"><div><small>EXPEDIENTE DE TRIAGE</small><h3>#${esc(t.id)} · ${esc(t.title)}</h3><p>${esc(t.requester)} · ${esc(t.status)} · ${esc(t.assignee)}</p></div><button type="button" class="tr-outline" data-open="${esc(t.id)}">Abrir ticket ↗</button></div>
      <form id="tr-diagnosis" class="tr-section"><h4>01 · Clasificación y diagnóstico</h4><div class="tr-grid">
      <label>Categoría<select name="category">${options(['Sin clasificar','Redes / VPN','Cuentas y accesos','Software','Hardware','Correo','Impresión','Otro'], d.category)}</select></label>
      <label>Impacto<select name="impact">${options(['Bajo','Medio','Alto'], d.impact)}</select></label>
      <label>Urgencia<select name="urgency">${options(['Baja','Media','Alta'], d.urgency)}</select></label></div>
      <div class="tr-priority">Prioridad sugerida: <strong id="tr-priority">${window.NexoTriageData.priority(d.impact,d.urgency)}</strong><span>· Prioridad actual: ${esc(t.priority)}</span><label><input type="checkbox" name="applyPriority" ${d.applyPriority ? 'checked' : ''}> Aplicar la prioridad sugerida al ticket</label></div>
      <label>Resumen del diagnóstico<textarea name="diagnosis" rows="3" maxlength="2500" placeholder="Síntomas, alcance, hipótesis y resultados, sin información sensible">${esc(d.diagnosis)}</textarea></label>
      <label>Nueva prueba realizada<textarea name="newTest" rows="2" maxlength="750" placeholder="Ej.: conexión a Internet verificada, funciona correctamente">${esc(d.newTest)}</textarea></label>
      <div class="tr-tests">${r.tests.length ? r.tests.map(test => `<div class="tr-test"><div>✓ ${esc(test.text)}${test.at ? `<small>${esc(date(test.at))}</small>` : ''}</div>${adapter.canRemoveTests ? `<button type="button" data-remove="${esc(test.id)}" aria-label="Quitar prueba">✕</button>` : ''}</div>`).join('') : '<p>Sin pruebas registradas.</p>'}</div>
      ${adapter.canRemoveTests ? '' : '<small>Las pruebas del servidor se conservan como historial y no se eliminan.</small>'}
      <button class="tr-primary" type="submit">Guardar clasificación y diagnóstico</button></form>
      <section class="tr-section"><h4>02 · Intelligence: sugerencias de apoyo</h4>${tips.map(g => `<div class="tr-tip"><strong>${esc(g.name)}</strong><small>Coincidencias: ${esc(g.found.join(', '))}</small><ul>${g.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ul></div>`).join('') || '<p>No hay sugerencias coincidentes. Realizar diagnóstico manual.</p>'}<small>Reglas textuales locales, no IA generativa. Las acciones las decide el técnico.</small></section>
      <form id="tr-handoff" class="tr-section"><h4>03 · Escalamiento o transferencia manual</h4><div class="tr-grid">
      <label>Nivel actual<input value="${esc(r.level)}" disabled data-readonly></label>
      <label>Destino<select name="toLevel">${[1,2,3].filter(level => `L${level}` !== r.level).map(level => `<option value="${level}" ${Number(h.toLevel) === level ? 'selected' : ''}>L${level}</option>`).join('')}</select></label>
      <label>Técnico destino (opcional)<select name="assigneeUserId"><option value="">Mantener asignado actual</option>${s.people.map(u => `<option value="${esc(u.id)}" ${String(h.assigneeUserId) === String(u.id) ? 'selected' : ''}>${esc(u.name)}${u.supportLevel ? ` · L${esc(u.supportLevel)}` : ''}</option>`).join('')}</select></label></div>
      <label>Motivo de transferencia<textarea name="reason" rows="2" maxlength="1800" ${adapter.mode === 'api' ? 'minlength="10"' : ''} required>${esc(h.reason)}</textarea></label>
      <label>Qué debe hacer el siguiente nivel<textarea name="pending" rows="2" maxlength="1500" ${adapter.mode === 'api' ? 'minlength="10"' : ''} required>${esc(h.pending)}</textarea></label>
      <small>Guardá el diagnóstico y al menos una prueba antes de transferir. La transferencia registra el nivel sin modificar automáticamente el estado del ticket.</small>
      <button class="tr-primary" type="submit">Confirmar transferencia</button></form>
      <section class="tr-section"><h4>04 · Historial de diagnóstico y transferencia</h4>${r.history.map(event => `<article class="tr-event"><strong>${esc(event.title)}</strong><small>${esc(date(event.at))}</small><p>${esc(event.text)}</p></article>`).join('') || '<p>No hay movimientos de triage todavía.</p>'}</section>`;
  }
  async function render(ctx) {
    currentContext = ctx;
    const token = ++generation, mode = source(), s = stateFor(mode), adapter = window.NexoTriageData.create(mode, ctx);
    const root = document.querySelector('#alternateView');
    if (!root) return;
    const live = () => token === generation && active(mode);
    if (mode === 'api' && !['Administrador','Coordinador','Técnico'].includes(window.NexoAuth.user?.role)) {
      root.innerHTML = '<section class="tr-section tr-access" role="alert"><h3>Acceso restringido</h3><p>Solo personal IT puede gestionar Triage.</p></section>';
      return;
    }
    const list = () => ctx.tickets.filter(t => (s.filter === 'todos' || (s.filter === 'abiertos' ? t.status !== 'Cerrado' : !s.index[String(t.id)])) && clean(`${t.id} ${t.title} ${t.requester}`).includes(clean(s.query)));
    const selected = () => ctx.tickets.find(t => String(t.id) === String(s.selected));
    function status() {
      if (!live()) return;
      const el = root.querySelector('.tr-status');
      const text = s.busy ? 'Guardando operación… Esperá la confirmación.' : s.loading ? 'Cargando expediente de Triage…' : s.error || s.notice || (mode === 'api' ? 'API + PostgreSQL · Cambios confirmados por el servidor.' : 'Demo local · Datos guardados solo en este navegador.');
      el.dataset.state = s.error ? 'error' : s.busy || s.loading ? 'pending' : 'ready';
      el.querySelector('[data-message]').textContent = text;
      el.querySelector('[data-retry]').hidden = !s.error;
      el.querySelector('[data-retry]').disabled = s.busy || s.loading;
      root.querySelector('.tr-layout').setAttribute('aria-busy', String(s.busy || s.loading));
      root.querySelectorAll('.tr-layout input, .tr-layout select, .tr-layout textarea, .tr-layout button').forEach(el => {
        el.disabled = s.busy || s.loading || s.requiresReload || el.hasAttribute('data-readonly');
      });
    }
    function drawList() {
      root.querySelector('.tr-items').innerHTML = list().map(t => {
        const entry = s.index[String(t.id)];
        return `<button type="button" class="tr-item ${String(t.id) === String(s.selected) ? 'on' : ''}" data-select="${esc(t.id)}" aria-pressed="${String(t.id) === String(s.selected)}"><span>#${esc(t.id)} · ${esc(entry?.level || 'L1')}${entry ? ' · Revisado' : ''}</span><b>${esc(t.title)}</b><small>${esc(t.priority)} · ${esc(t.status)}</small></button>`;
      }).join('') || '<p class="tr-empty">Sin tickets para el filtro.</p>';
      root.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => { void chooseTicket(button.dataset.select); }));
    }
    function mount() {
      root.onclick = null; root.oninput = null;
      const entries = Object.values(s.index);
      root.innerHTML = `<div class="tr-workspace" data-mode="${mode}"><div class="tr-hero"><span>NEXODESK · TRIAGE L1–L3</span><h2>Diagnosticar, documentar, escalar.</h2><p>Herramienta para Help Desk L1, L2 y L3. Intelligence sugiere; el técnico decide.</p></div>
        <div class="tr-stats"><div><small>Abiertos</small><b>${ctx.tickets.filter(t => t.status !== 'Cerrado').length}</b></div><div><small>Con triage</small><b>${s.loading ? '—' : entries.length}</b></div><div><small>En L2 / L3</small><b>${s.loading ? '—' : entries.filter(e => e.level !== 'L1').length}</b></div></div>
        <div class="tr-status" role="status" aria-live="polite"><span data-message></span><button type="button" class="tr-outline" data-retry hidden>Volver a cargar</button></div>
        <div class="tr-layout"><section class="tr-side"><h3>Bandeja de tickets</h3><input id="tr-search" type="search" aria-label="Buscar tickets" placeholder="Buscar por ID, asunto, solicitante" value="${esc(s.query)}"><select id="tr-filter" aria-label="Filtrar tickets">${options(['abiertos','todos','sin triage'],s.filter)}</select><div class="tr-items"></div></section><section class="tr-main"></section></div>
        <p class="tr-note">${mode === 'api' ? 'API + PostgreSQL · Sesión y permisos validados por el servidor. La bandeja y las estadísticas corresponden a los tickets cargados (máximo 200). No se guardan expedientes en el navegador.' : 'Demo local sin permisos reales: no ingreses contraseñas ni datos confidenciales. Los registros solo se guardan en este navegador.'}</p></div>`;
      drawList(); drawDetail(); status();
      for (const [id, key] of [['tr-search','query'], ['tr-filter','filter']]) {
        root.querySelector('#' + id).addEventListener(id === 'tr-search' ? 'input' : 'change', e => {
          const previous = s[key]; s[key] = e.target.value;
          if (!list().some(t => String(t.id) === String(s.selected)) && s.dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos para cambiar el filtro?')) {
            s[key] = previous; e.target.value = previous; return;
          }
          drawList();
          if (!list().some(t => String(t.id) === String(s.selected))) void chooseTicket(list()[0]?.id ?? null, true);
        });
      }
      root.querySelector('[data-retry]').addEventListener('click', async () => {
        if (s.dirty && !confirm('Se recargará el estado guardado. ¿Descartar los cambios del formulario?')) return;
        s.dirty = false; s.draft = null; s.requiresReload = false;
        if (mode === 'api' && !window.NexoBridge.isReady()) {
          await window.NexoBridge.reload();
          if (!active(mode)) return;
          if (!window.NexoBridge.isReady()) {
            s.error = 'No se pudieron recargar los tickets. Comprobá la conexión y volvé a intentar.';
            s.requiresReload = true;
          }
        }
        void render(currentContext);
      });
    }
    function captureDraft() {
      const d = root.querySelector('#tr-diagnosis'), h = root.querySelector('#tr-handoff');
      if (!d || !h) return;
      s.draft = {diagnosis:{category:d.elements.category.value, impact:d.elements.impact.value, urgency:d.elements.urgency.value,
        diagnosis:d.elements.diagnosis.value, newTest:d.elements.newTest.value, applyPriority:d.elements.applyPriority.checked},
        transfer:{toLevel:h.elements.toLevel.value, assigneeUserId:h.elements.assigneeUserId.value, reason:h.elements.reason.value, pending:h.elements.pending.value}};
      s.dirty = true;
      root.querySelector('#tr-priority').textContent = window.NexoTriageData.priority(s.draft.diagnosis.impact,s.draft.diagnosis.urgency);
    }
    function drawDetail() {
      const t = selected(), el = root.querySelector('.tr-main');
      el.innerHTML = t && s.record ? detail(t,s.record,s,adapter) : '<p class="tr-empty">' + (s.loading ? 'Cargando expediente…' : 'Seleccioná un ticket de la bandeja.') + '</p>';
      el.querySelector('[data-open]')?.addEventListener('click', () => ctx.openTicket(t.id));
      el.querySelectorAll('form').forEach(form => {
        form.addEventListener('input', captureDraft);
        form.addEventListener('change', captureDraft);
      });
      el.querySelector('#tr-diagnosis')?.addEventListener('submit', e => {
        e.preventDefault(); if (s.busy || s.loading || s.requiresReload) return;
        captureDraft();
        const d = s.draft.diagnosis;
        void mutate(() => adapter.save(t.id,{...d, diagnosis:d.diagnosis.trim(), newTest:d.newTest.trim()}), 'Diagnóstico guardado.');
      });
      el.querySelector('#tr-handoff')?.addEventListener('submit', e => {
        e.preventDefault(); if (s.busy || s.loading || s.requiresReload) return;
        captureDraft();
        if (!s.record.diagnosis.trim() || !s.record.tests.length) { s.error = 'Registrá diagnóstico y al menos una prueba antes de transferir.'; status(); return; }
        const d = s.draft.diagnosis;
        if (d.diagnosis !== s.record.diagnosis || d.newTest.trim() || d.category !== s.record.category || d.impact !== s.record.impact || d.urgency !== s.record.urgency || d.applyPriority) {
          s.error = 'Guardá los cambios del diagnóstico antes de transferir.'; status(); return;
        }
        const h = s.draft.transfer;
        if (!confirm(`¿Confirmar transferencia de ${s.record.level} a L${h.toLevel} para el ticket #${t.id}?`)) return;
        void mutate(() => adapter.transfer(t.id,{toLevel:Number(h.toLevel), reason:h.reason.trim(), pending:h.pending.trim(), assigneeUserId:h.assigneeUserId ? Number(h.assigneeUserId) : null}), 'Transferencia registrada.');
      });
      el.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
        if (s.busy || s.loading || s.requiresReload || !adapter.canRemoveTests) return;
        if (s.dirty && !confirm('¿Descartar los cambios del formulario para quitar esta prueba?')) return;
        void mutate(() => adapter.removeTest(t.id,button.dataset.remove), 'Prueba eliminada en demo local.');
      }));
    }
    async function chooseTicket(id, discard = false) {
      if (s.busy || s.loading || s.requiresReload) return;
      if (!discard && s.dirty && !confirm('Hay cambios sin guardar. ¿Descartarlos para abrir otro ticket?')) return;
      s.selected = id; s.record = null; s.draft = null; s.dirty = false; s.error = '';
      s.loading = id !== null; drawList(); drawDetail(); status();
      try { const record = id === null ? null : await adapter.get(id); if (live()) s.record = record; }
      catch (err) { if (live()) s.error = err.message || 'No se pudo cargar el expediente.'; }
      finally { if (live()) { s.loading = false; drawDetail(); status(); } }
    }
    async function mutate(operation, notice) {
      if (s.busy || s.loading || s.requiresReload) return;
      s.busy = true; s.error = ''; status();
      try {
        s.record = await operation();
        s.dirty = false; s.draft = null; s.notice = notice;
        s.index[String(s.selected)] = {level:s.record.level};
        // Nunca usar saveTickets (almacenamiento demo) como alternativa a la API.
        if (mode === 'api' && source() === mode) {
          await window.NexoBridge.reload();
          if (source() === mode && !window.NexoBridge.isReady()) {
            s.error = 'Operación guardada, pero no se pudieron recargar los tickets. Volvé a cargar para continuar.';
            s.requiresReload = true;
          }
        }
      } catch (err) {
        s.error = err.message || 'No se pudo completar la operación.';
        if (mode === 'api' && (!err.status || err.status >= 500)) {
          s.requiresReload = true;
          s.error += ' No se pudo confirmar el resultado. Volvé a cargar antes de reintentar; no se guardó una copia local.';
        }
      } finally {
        s.busy = false;
        if (active(mode)) {
          if (s.error && live()) status();
          else if (s.error) void render(currentContext);
          else void render(currentContext);
        }
      }
    }
    // Estados independientes por modo; borradores y operaciones sobreviven a
    // renders externos y las respuestas tardías no sobrescriben otra vista.
    if (s.busy || s.dirty || s.requiresReload) { mount(); return; }
    s.loading = true; s.error = ''; s.record = null; mount();
    try {
      const loaded = await adapter.load();
      if (!live()) return;
      s.index = loaded.index; s.people = loaded.people;
      if (!list().some(t => String(t.id) === String(s.selected))) s.selected = list()[0]?.id ?? null;
      const record = s.selected === null ? null : await adapter.get(s.selected);
      if (!live()) return;
      s.record = record;
      s.loading = false; mount();
    } catch (err) {
      if (!live()) return;
      s.loading = false; s.error = err.message || 'No se pudo cargar Triage.'; mount();
    }
  }
  window.NexoV15 = {render:context => { void render(context); }};
})();
