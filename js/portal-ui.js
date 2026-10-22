/* Portal compartido: el centro de ayuda y los formularios usan una sola vista.
 * El adaptador decide el origen; el Portal público siempre es una demo local. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge = text => `<span class="nx-pill">${esc(text)}</span>`;
  const empty = text => `<div class="nx-empty">${esc(text)}</div>`;
  const source = publicMode => !publicMode && window.NexoAuth?.source === 'api' ? 'api' : 'demo';
  const freshDraft = () => ({requester:'', type:'Incidente', title:'', description:'', priority:'Media'});
  const guides = [
    {id:'vpn',icon:'◈',category:'Conectividad',title:'No puedo conectarme a la VPN',details:['Comprobá que tengas conexión a Internet.','Cerrá y abrí de nuevo el cliente VPN.','Verificá que no estés usando una contraseña antigua.','Si persiste, creá un ticket e indicá el mensaje de error.']},
    {id:'password',icon:'◇',category:'Accesos',title:'Olvidé mi contraseña',details:['Comprobá que el teclado esté en el idioma correcto.','Si tu empresa dispone de restablecimiento de contraseña, utilizá ese canal autorizado.','No compartas contraseñas por tickets.','Solicitá ayuda a soporte si seguís sin poder ingresar.']},
    {id:'printer',icon:'▤',category:'Dispositivos',title:'La impresora no responde',details:['Comprobá que esté encendida y sin mensajes de error.','Verificá si hay papel o atascos.','Revisá la impresora seleccionada en Windows.','Creá un ticket si el problema continúa.']},
    {id:'software',icon:'▣',category:'Software',title:'Necesito instalar una aplicación',details:['Identificá la aplicación y la versión necesaria.','Verificá si requiere aprobación o licencia.','No descargues instaladores no autorizados.','Creá una solicitud de instalación para IT.']}
  ];
  const states = new Map();
  let generation = 0;
  function getState(key) {
    if (!states.has(key)) states.set(key, {draft:freshDraft(), dirty:false, items:[], limit:null,
      guideQuery:'', guideId:null, lookupId:'', detail:null, lookupError:'', lookupBusy:false,
      loading:false, busy:false, readError:false, requiresReload:false, error:'', notice:'',
      loadVersion:0, lookupVersion:0, mutationVersion:0, refreshRequested:false});
    return states.get(key);
  }
  function guideCards(query) {
    return guides.filter(g => `${g.title} ${g.category}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
      .map(g => `<button type="button" class="nx-guide" data-guide="${g.id}" aria-expanded="false"><span class="nx-guide-icon">${g.icon}</span><small>${esc(g.category)}</small><b>${esc(g.title)}</b><span>Ver pasos →</span></button>`).join('') || empty('No encontramos un artículo con ese término.');
  }
  const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString('es-AR') : '—';
  function render(ctx, root, {publicMode = false} = {}) {
    if (!root) return;
    const mode = source(publicMode), s = getState(publicMode ? 'public-demo' : mode), token = ++generation;
    const adapter = window.NexoModulesData.portal(mode,ctx,{publicMode});
    s.ctx = ctx; s.root = root; s.publicMode = publicMode;
    // Volver a montar una vista invalida sus lecturas, nunca una escritura pendiente.
    s.loadVersion++; s.lookupVersion++; s.loading = false; s.lookupBusy = false;
    const current = () => root.isConnected && source(publicMode) === mode &&
      (publicMode || !!document.querySelector('.nav-item[data-view="portal"].active'));
    const live = () => token === generation && current();
    const rerenderCurrent = () => { if (current()) render(s.ctx,s.root,{publicMode:s.publicMode}); };
    const api = mode === 'api';
    const userName = api ? String(window.NexoAuth?.user?.name || 'Usuario autenticado') : s.draft.requester;
    root.onclick = null; root.oninput = null;
    root.innerHTML = `<div class="nx-workspace nx-portal-workspace" data-mode="${mode}">
      <div class="nx-hero nx-hero-portal"><div><span class="nx-kicker">NEXODESK PORTAL · AUTOSERVICIO</span><h2>¿En qué podemos ayudarte hoy?</h2><p>Encontrá respuestas rápidas o registrá una solicitud que se incorporará a la gestión de tickets.</p></div><div class="nx-portal-icon" aria-hidden="true">⌂</div></div>
      <div class="nx-module-status" role="status" aria-live="polite"><span data-module-message></span><button type="button" id="nxPortalRefresh" class="nx-mini-btn">Actualizar solicitudes</button></div>
      <section class="nx-panel"><div class="nx-panel-head"><h3>Centro de ayuda</h3><span>${guides.length} artículos</span></div><input id="nxGuideSearch" class="nx-search nx-search-full" type="search" value="${esc(s.guideQuery)}" placeholder="Buscar una solución: VPN, contraseña, impresora..." aria-label="Buscar artículos"><div class="nx-guide-grid" id="nxGuideGrid">${guideCards(s.guideQuery)}</div><div id="nxGuideDetail" class="nx-guide-detail" hidden></div></section>
      <div class="nx-two-col"><section class="nx-panel"><h3>Registrar una solicitud</h3><p class="nx-hint">${api ? 'La sesión identifica al solicitante. La prioridad inicial es Media y el estado es Registrado.' : 'Describí el problema y el sistema creará un ticket en estado Registrado.'}</p>
      <form class="nx-form" id="nxPortalForm"><label>Nombre del solicitante<input name="requester" required maxlength="${api ? 120 : 90}" value="${esc(userName)}" ${api ? 'readonly aria-readonly="true"' : ''} placeholder="Ej. María López" autocomplete="name"></label>
      <label>Tipo<select name="type">${['Incidente','Requerimiento','Consulta'].map(v => `<option ${v === s.draft.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Asunto<input name="title" required minlength="${api ? 3 : 1}" maxlength="${api ? 160 : 100}" value="${esc(s.draft.title)}" placeholder="Ej. Error al conectar VPN"></label>
      <label>Descripción<textarea name="description" required minlength="${api ? 5 : 1}" maxlength="${api ? 5000 : 1500}" rows="4" placeholder="¿Qué pasa? ¿Desde cuándo? ¿Qué intentaste?">${esc(s.draft.description)}</textarea></label>
      <label>Prioridad<select name="priority" ${api ? 'disabled data-server-fixed' : ''}>${['Media','Alta','Baja'].map(v => `<option ${(api ? v === 'Media' : v === s.draft.priority) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button type="submit" class="nx-cta">Enviar solicitud ↗</button><p id="portalStatus" class="nx-form-feedback" role="status" aria-live="polite" hidden></p></form></section>
      <section class="nx-panel nx-portal-tracking"><div class="nx-panel-head"><h3>Seguimiento de solicitudes</h3><span data-request-count></span></div><p class="nx-hint">${api ? 'Solo se muestran solicitudes asociadas a tu cuenta. También podés consultar una solicitud propia por número.' : 'Consultá el estado con el número de ticket. Los datos pertenecen solo a este navegador.'}</p>
      <div class="nx-lookup"><input id="nxLookupId" type="number" min="1" step="1" value="${esc(s.lookupId)}" placeholder="Ej. 10301" aria-label="Número de ticket"><button type="button" id="nxLookup" class="nx-mini-btn">Consultar</button></div>
      <div id="nxLookupResult" role="status" aria-live="polite"></div><div class="nx-table-wrap" role="region" aria-label="Solicitudes, desplazable horizontalmente" tabindex="0"><table class="nx-table nx-request-table"><thead><tr><th>Número</th><th>Solicitud</th><th>Estado</th><th>Prioridad</th><th>Registrado</th></tr></thead><tbody id="nxPortalRequests"></tbody></table></div>
      ${publicMode ? '<a class="nx-minor-link" href="login.html">Acceso para técnicos y administradores →</a>' : '<button type="button" class="nx-mini-btn" data-go-view="tickets">Ver gestión de tickets →</button>'}</section></div>
      <p class="nx-hint">${api ? 'API + PostgreSQL · La identidad y los permisos se comprueban en el servidor. No se guardan solicitudes en el navegador.' : 'Demo local · No ingreses datos sensibles. Las solicitudes se guardan solamente en este navegador y no se importan al servidor.'}</p></div>`;

    function status() {
      if (!live()) return;
      const el = root.querySelector('.nx-module-status');
      const text = s.busy ? 'Registrando solicitud… Esperá la confirmación.' : s.loading ? 'Cargando solicitudes…' : s.error || s.notice || (api ? 'API + PostgreSQL · Sesión verificada.' : 'Demo local · Almacenamiento de este navegador.');
      el.dataset.state = s.error ? 'error' : s.busy || s.loading ? 'pending' : 'ready';
      el.querySelector('[data-module-message]').textContent = text;
      root.querySelector('#nxPortalRefresh').disabled = s.busy || s.loading;
      const form = root.querySelector('#nxPortalForm');
      form.setAttribute('aria-busy',String(s.busy || s.loading));
      form.querySelectorAll('input,select,textarea,button').forEach(control => {
        control.disabled = s.busy || s.loading || s.readError || s.requiresReload || control.hasAttribute('data-server-fixed');
      });
      const feedback = root.querySelector('#portalStatus');
      feedback.hidden = !s.error && !s.notice && !s.busy;
      feedback.textContent = s.busy ? 'Registrando…' : s.error || s.notice;
      feedback.dataset.state = s.error ? 'error' : 'ready';
      root.querySelector('#nxLookup').disabled = s.lookupBusy || s.busy;
      root.querySelector('#nxLookupId').disabled = s.lookupBusy || s.busy;
      root.querySelectorAll('[data-portal-id]').forEach(button => { button.disabled = s.lookupBusy || s.busy; });
    }
    function paintRequests() {
      if (!live()) return;
      const count = root.querySelector('[data-request-count]');
      count.textContent = s.loading ? 'Cargando…' : `${s.items.length} solicitud(es)${s.limit ? ` · máximo ${s.limit}` : ''}`;
      root.querySelector('#nxPortalRequests').innerHTML = s.items.map(t => `<tr><td>#${esc(t.id)}</td><td><button type="button" class="nx-text-btn" data-portal-id="${esc(t.id)}">${esc(t.title)}</button><small class="nx-sub">${esc(t.type)}</small></td><td>${badge(t.status)}</td><td>${badge(t.priority)}</td><td>${esc(date(t.createdAt))}</td></tr>`).join('') || `<tr><td colspan="5">${s.loading ? 'Cargando solicitudes…' : 'Todavía no hay solicitudes disponibles en este origen.'}</td></tr>`;
      root.querySelectorAll('[data-portal-id]').forEach(button => button.addEventListener('click', () => {
        s.lookupId = button.dataset.portalId; root.querySelector('#nxLookupId').value = s.lookupId; void lookup(s.lookupId);
      }));
    }
    function paintDetail() {
      if (!live()) return;
      const el = root.querySelector('#nxLookupResult');
      if (s.lookupBusy) { el.textContent = 'Cargando solicitud…'; return; }
      if (s.lookupError) { el.textContent = s.lookupError; return; }
      if (!s.detail) { el.innerHTML = empty('Elegí una solicitud o ingresá su número para consultar el detalle.'); return; }
      const t = s.detail;
      el.innerHTML = `<div class="nx-lookup-result"><b>#${esc(t.id)} · ${esc(t.title)}</b><span>${badge(t.status)} ${badge(t.priority)}</span><small>Solicitante: ${esc(api ? userName : t.requester || 'Demo local')}</small>${t.description ? `<p class="nx-request-description">${esc(t.description)}</p>` : ''}</div>`;
    }
    function showGuide() {
      const guide = guides.find(g => g.id === s.guideId), el = root.querySelector('#nxGuideDetail');
      el.hidden = !guide;
      el.innerHTML = guide ? `<h3>${esc(guide.title)}</h3><ol>${guide.details.map(step => `<li>${esc(step)}</li>`).join('')}</ol>` : '';
      root.querySelectorAll('[data-guide]').forEach(button => button.setAttribute('aria-expanded',String(button.dataset.guide === s.guideId)));
    }
    async function load({explicit = false} = {}) {
      if (s.busy || s.loading) return;
      const version = ++s.loadVersion;
      s.loading = true; s.error = ''; status(); paintRequests();
      try {
        const result = await adapter.list();
        if (!live() || version !== s.loadVersion) return;
        s.items = result.items; s.limit = result.limit; s.readError = false;
        if (explicit && s.requiresReload) {
          s.requiresReload = false;
          s.notice = 'Solicitudes actualizadas. Revisá si la solicitud ya aparece antes de volver a enviarla.';
        }
      } catch (err) {
        if (!live() || version !== s.loadVersion) return;
        s.readError = true;
        s.error = err.message || 'No se pudieron cargar las solicitudes.';
      } finally {
        if (version === s.loadVersion) s.loading = false;
        if (live()) { paintRequests(); status(); }
      }
    }
    async function lookup(raw) {
      if (s.lookupBusy || s.busy) return;
      const id = Number(raw);
      if (!Number.isSafeInteger(id) || id <= 0) { s.lookupError = 'Ingresá un número de ticket válido.'; s.detail = null; paintDetail(); return; }
      const version = ++s.lookupVersion;
      s.lookupBusy = true; s.lookupError = ''; s.detail = null; paintDetail(); status();
      try {
        const item = await adapter.get(id);
        if (!live() || version !== s.lookupVersion) return;
        s.detail = item;
      } catch (err) {
        if (live() && version === s.lookupVersion) s.lookupError = err.message || 'No se pudo consultar la solicitud.';
      } finally {
        if (version === s.lookupVersion) s.lookupBusy = false;
        if (live()) { paintDetail(); status(); }
      }
    }
    const form = root.querySelector('#nxPortalForm');
    function capture() {
      if (!live() || s.busy || s.loading || s.requiresReload) return;
      s.draft = {requester:form.elements.requester.value, type:form.elements.type.value,
        title:form.elements.title.value, description:form.elements.description.value,
        priority:api ? 'Media' : form.elements.priority.value};
      s.dirty = true;
    }
    form.addEventListener('input',capture); form.addEventListener('change',capture);
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (!live() || s.busy || s.loading || s.readError || s.requiresReload) return;
      capture();
      const payload = {...s.draft,requester:s.draft.requester.trim(),title:s.draft.title.trim(),description:s.draft.description.trim()};
      if (!payload.title || !payload.description || (!api && !payload.requester)) {
        s.error = 'Completá el solicitante, el asunto y la descripción sin dejar solo espacios.'; status(); return;
      }
      const operation = ++s.mutationVersion;
      s.busy = true; s.error = ''; status();
      let created;
      try {
        created = await adapter.create(payload);
      } catch (err) {
        if (operation !== s.mutationVersion) return;
        s.error = err.message || 'No se pudo registrar la solicitud.';
        if (api && (!err.status || err.status >= 500)) {
          s.requiresReload = true;
          s.error += ' No se pudo confirmar el resultado. Actualizá las solicitudes antes de reintentar; no se creó una copia local.';
        }
      }
      if (created && operation === s.mutationVersion) {
        // Un POST confirmado no se vuelve a enviar aunque la actualización de tickets falle.
        s.draft = freshDraft(); s.dirty = false; s.detail = null; s.lookupError = '';
        s.items = [created,...s.items.filter(item => String(item.id) !== String(created.id))];
        s.notice = `Solicitud #${created.id} creada ${api ? 'en PostgreSQL' : 'en este navegador'}.`;
        if (current()) {
          try {
            if (api) {
              await window.NexoBridge.reload();
              if (source(publicMode) === mode && !window.NexoBridge.isReady()) throw Error('No se pudieron actualizar los tickets.');
            } else if (!publicMode) s.ctx.render?.();
          } catch (err) {
            s.requiresReload = true;
            s.error = `${s.notice} No se pudo actualizar la vista. Actualizá las solicitudes para continuar.`;
          }
        }
      }
      if (operation === s.mutationVersion) s.busy = false;
      if (current()) rerenderCurrent();
    });
    root.querySelector('#nxGuideSearch').addEventListener('input',event => {
      s.guideQuery = event.target.value; s.guideId = null;
      root.querySelector('#nxGuideGrid').innerHTML = guideCards(s.guideQuery); showGuide();
    });
    root.querySelector('#nxGuideGrid').addEventListener('click',event => {
      const button = event.target.closest('[data-guide]'); if (!button) return;
      s.guideId = button.dataset.guide; showGuide();
    });
    root.querySelector('#nxLookupId').addEventListener('input',event => { s.lookupId = event.target.value; });
    root.querySelector('#nxLookupId').addEventListener('keydown',event => { if (event.key === 'Enter') { event.preventDefault(); void lookup(s.lookupId); } });
    root.querySelector('#nxLookup').addEventListener('click',() => { void lookup(s.lookupId); });
    root.querySelector('#nxPortalRefresh').addEventListener('click',async () => {
      if (s.busy || s.loading) return;
      if (api && window.NexoBridge && !window.NexoBridge.isReady()) {
        // Recuperar también la bandeja después de un POST confirmado cuyo
        // refresco falló. Este botón solo repite lecturas, nunca el alta.
        s.refreshRequested = true; s.busy = true; status();
        try {
          await window.NexoBridge.reload();
          if (source(publicMode) === mode && !window.NexoBridge.isReady()) {
            s.refreshRequested = false; s.requiresReload = true;
            s.error = 'No se pudieron actualizar los tickets. Comprobá la conexión y volvé a intentar; no se reenviará la solicitud.';
          }
        } catch (err) {
          s.refreshRequested = false; s.requiresReload = true;
          s.error = 'No se pudieron actualizar los tickets. Comprobá la conexión y volvé a intentar; no se reenviará la solicitud.';
        } finally {
          s.busy = false;
          rerenderCurrent();
        }
      } else void load({explicit:true});
    });
    root.querySelector('[data-go-view]')?.addEventListener('click',() => window.dispatchEvent(new CustomEvent('nexodesk:open-view',{detail:'tickets'})));
    paintRequests(); paintDetail(); showGuide(); status();
    if (!s.busy && s.refreshRequested) {
      s.refreshRequested = false; void load({explicit:true});
    } else if (!s.busy && !s.requiresReload && !s.error) void load();
  }
  window.NexoPortal = {render};
})();
