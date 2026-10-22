/* Assets: una vista compartida para inventario demo y PostgreSQL. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modeNow = () => window.NexoAuth?.source === 'api' ? 'api' : 'demo';
  const staff = () => ['Administrador','Coordinador','Técnico'].includes(window.NexoAuth?.user?.role);
  const states = new Map();
  const contexts = new Map();
  let generation = 0, mountedEditor = null;
  const active = mode => modeNow() === mode && !!document.querySelector('.nav-item[data-view="assets"].active');
  const options = (items, current) => items.map(item => `<option value="${esc(item)}" ${String(item) === String(current) ? 'selected' : ''}>${esc(item)}</option>`).join('');
  const code = (asset, mode) => mode === 'api' ? `NX-A${asset.id}` : asset.id;
  function stateFor(mode) {
    if (!states.has(mode)) states.set(mode, {items:[], limit:null, query:'', loaded:false, loading:false, busy:false, requiresReload:false, error:'', notice:'', editor:null});
    return states.get(mode);
  }
  function closeEditor(editor, preserve = false, restoreFocus = true) {
    if (!editor) return;
    if (editor.dialog.open) editor.dialog.close();
    editor.dialog.remove();
    editor.open = false;
    if (mountedEditor === editor) mountedEditor = null;
    if (!preserve && editor.state.editor === editor) editor.state.editor = null;
    if (restoreFocus && active(editor.mode) && editor.opener?.isConnected) editor.opener.focus();
  }
  // El diálogo vive fuera del panel; cerrarlo al abandonar la vista impide
  // enviar un formulario capturado desde otro origen o una sesión distinta.
  new MutationObserver(() => {
    if (mountedEditor && !active(mountedEditor.mode)) closeEditor(mountedEditor, mountedEditor.state.busy, false);
  }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class','hidden']});

  async function render(ctx, root) {
    if (!root) return;
    const mode = modeNow(), state = stateFor(mode), token = ++generation;
    contexts.set(mode, {ctx, root});
    const live = () => token === generation && active(mode) && root.querySelector('.nx-assets-workspace')?.dataset.mode === mode;
    if (mountedEditor && mountedEditor.mode !== mode) closeEditor(mountedEditor, mountedEditor.state.busy, false);
    if (mode === 'api' && !staff()) {
      if (mountedEditor) closeEditor(mountedEditor, mountedEditor.state.busy, false);
      root.innerHTML = '<section class="nx-workspace nx-assets-workspace nx-panel" data-mode="api" role="alert"><h3>Acceso restringido</h3><p>Solo técnicos, coordinadores y administradores pueden gestionar el inventario.</p></section>';
      return;
    }
    const adapter = window.NexoModulesData.assets(mode, ctx);
    function status() {
      if (!live()) return;
      const box = root.querySelector('.nx-module-status');
      const message = state.busy ? 'Guardando activo… Esperá la confirmación.' : state.loading ? 'Cargando inventario…' : state.error || state.notice || (mode === 'api' ? 'API + PostgreSQL · Inventario confirmado por el servidor.' : 'Demo local · Inventario guardado solo en este navegador.');
      box.dataset.state = state.error ? 'error' : state.busy || state.loading ? 'pending' : 'ready';
      box.querySelector('[data-assets-message]').textContent = message;
      const locked = state.loading || state.busy || state.requiresReload || !state.loaded;
      root.querySelectorAll('#nxAddAsset, #nxSearchAssets, [data-edit-asset], [data-ticket]').forEach(el => { el.disabled = locked; });
      root.querySelector('[data-assets-refresh]').disabled = state.busy || state.loading;
      root.querySelector('.nx-assets-workspace').setAttribute('aria-busy', String(state.busy || state.loading));
    }
    function rows() {
      const body = root.querySelector('tbody');
      const query = state.query.toLocaleLowerCase('es');
      const filtered = state.items.filter(asset => [code(asset,mode),asset.kind,asset.brand,asset.serial,asset.owner,asset.location,asset.state,asset.ticketId].join(' ').toLocaleLowerCase('es').includes(query));
      body.innerHTML = !state.loaded ? '<tr><td colspan="7">' + (state.loading ? 'Cargando activos…' : 'El inventario no está disponible. Usá Actualizar inventario para volver a cargarlo.') + '</td></tr>' : filtered.map(asset => {
        const linked = asset.ticketId !== null && asset.ticketId !== undefined;
        return `<tr><td><strong>${esc(code(asset,mode))}</strong><small class="nx-sub">${esc(asset.kind)}</small></td><td>${esc(asset.brand)}<small class="nx-sub">Serie: ${esc(asset.serial)}</small></td><td>${esc(asset.owner)}</td><td>${esc(asset.location)}</td><td><span class="nx-pill">${esc(asset.state)}</span></td><td>${linked ? `<button type="button" class="nx-text-btn" data-ticket="${esc(asset.ticketId)}">#${esc(asset.ticketId)} ↗</button>` : '—'}</td><td><button type="button" class="nx-mini-btn" data-edit-asset="${esc(asset.id)}">Editar</button></td></tr>`;
      }).join('') || '<tr><td colspan="7">No hay resultados. Probá otra búsqueda o creá un activo.</td></tr>';
      body.querySelectorAll('[data-edit-asset]').forEach(button => button.addEventListener('click', () => {
        const asset = state.items.find(item => String(item.id) === button.dataset.editAsset);
        if (asset && !state.busy && !state.loading && !state.requiresReload) openEditor(ctx, root, mode, state, adapter, asset, button);
      }));
      body.querySelectorAll('[data-ticket]').forEach(button => button.addEventListener('click', () => {
        if (!active(mode)) return;
        const ticket = ctx.tickets.find(ticket => String(ticket.id) === button.dataset.ticket);
        if (ticket) ctx.openTicket(ticket.id);
        else {
          state.error = `El ticket #${button.dataset.ticket} no está en la bandeja cargada. Actualizá los tickets para consultar su ficha; el vínculo del activo se conserva.`;
          status();
        }
      }));
    }
    function mount() {
      root.onclick = null; root.oninput = null;
      const count = predicate => state.loaded ? state.items.filter(predicate).length : '—';
      root.innerHTML = `<div class="nx-workspace nx-assets-workspace" data-mode="${mode}"><div class="nx-hero nx-hero-assets"><div><span class="nx-kicker">INVENTARIO IT · ASSETS</span><h2>Los equipos y sus incidentes, conectados.</h2><p>Registrá dispositivos, seguí asignaciones y vinculá un ticket con un activo.</p></div><button type="button" class="nx-cta" id="nxAddAsset">＋ Nuevo activo</button></div>
        <div class="nx-metrics"><article><small>Dispositivos</small><strong>${state.loaded ? state.items.length : '—'}</strong></article><article><small>Asignados</small><strong>${count(asset => asset.state === 'Asignado')}</strong></article><article><small>Disponibles</small><strong>${count(asset => asset.state === 'Disponible')}</strong></article><article><small>En reparación</small><strong>${count(asset => asset.state === 'En reparación')}</strong></article></div>
        <div class="nx-module-status" role="status" aria-live="polite"><span data-assets-message></span><button type="button" class="nx-mini-btn" data-assets-refresh>Actualizar inventario</button></div>
        <section class="nx-panel"><div class="nx-panel-head nx-wrap"><h3>Inventario de dispositivos</h3><input type="search" class="nx-search" id="nxSearchAssets" value="${esc(state.query)}" maxlength="100" placeholder="Buscar por serie, usuario, ubicación..." aria-label="Buscar activos"></div><div class="nx-table-wrap" tabindex="0" role="region" aria-label="Inventario de activos, desplazable horizontalmente"><table class="nx-table nx-assets-table"><caption class="nx-assets-scope">${mode === 'api' ? `Datos del servidor · Hasta ${state.limit || 200} activos cargados. La búsqueda y las estadísticas corresponden a esta lista.` : 'Datos locales de demostración · No se comparten entre navegadores.'} Un ticket principal por activo.</caption><thead><tr><th scope="col">Código</th><th scope="col">Equipo</th><th scope="col">Usuario</th><th scope="col">Ubicación</th><th scope="col">Estado</th><th scope="col">Ticket</th><th scope="col">Acciones</th></tr></thead><tbody></tbody></table></div></section>
        <p class="nx-hint">${mode === 'api' ? 'Los activos se guardan en PostgreSQL y requieren una sesión IT autorizada. No se utiliza almacenamiento demo si el servidor falla.' : 'Los activos de ejemplo no representan equipos reales. No guardes información sensible en esta demo.'}</p></div>`;
      rows(); status();
      root.querySelector('#nxAddAsset').addEventListener('click', event => {
        if (state.loaded && !state.busy && !state.loading && !state.requiresReload) openEditor(ctx, root, mode, state, adapter, null, event.currentTarget);
      });
      root.querySelector('#nxSearchAssets').addEventListener('input', event => { state.query = event.target.value; rows(); status(); });
      root.querySelector('[data-assets-refresh]').addEventListener('click', () => {
        if (state.busy || state.loading) return;
        if (mountedEditor?.mode === mode) closeEditor(mountedEditor);
        state.requiresReload = false; state.error = ''; state.notice = '';
        void render(ctx,root);
      });
    }
    if (state.busy || state.requiresReload) { mount(); return; }
    state.loading = true; state.error = ''; mount();
    try {
      const result = await adapter.list();
      if (!live()) return;
      state.items = result.items; state.limit = result.limit; state.loaded = true;
    } catch (err) {
      if (!live()) return;
      state.loaded = false;
      state.error = (state.notice === 'Activo guardado correctamente.' ? 'El activo se guardó, pero no se pudo actualizar la lista. ' : '') + (err.message || 'No se pudo cargar el inventario.');
    } finally {
      if (live()) { state.loading = false; mount(); }
    }
  }

  function openEditor(ctx, root, mode, state, adapter, existing, opener) {
    if (!active(mode) || state.busy || state.loading || state.requiresReload) return;
    if (mountedEditor) closeEditor(mountedEditor);
    const asset = existing || {id:null,kind:'Notebook',brand:'',serial:'',owner:'Sin asignar',location:'',state:'Disponible',ticketId:null};
    const dialog = document.createElement('dialog');
    dialog.className = 'nx-workspace nx-module-dialog nx-assets-dialog';
    dialog.dataset.mode = mode;
    dialog.setAttribute('aria-labelledby','nxAssetTitle');
    const hasCurrentTicket = asset.ticketId !== null && asset.ticketId !== undefined;
    const loadedCurrent = ctx.tickets.some(ticket => String(ticket.id) === String(asset.ticketId));
    const tickets = ctx.tickets.map(ticket => `<option value="${esc(ticket.id)}" ${String(ticket.id) === String(asset.ticketId) ? 'selected' : ''}>#${esc(ticket.id)} · ${esc(ticket.title)}</option>`).join('');
    dialog.innerHTML = `<div class="nx-panel-head"><h3 id="nxAssetTitle">${existing ? 'Editar' : 'Nuevo'} activo</h3><button type="button" class="nx-mini-btn" id="nxCloseAsset" aria-label="Cerrar editor de activo">✕ Cerrar</button></div>
      <p class="nx-hint">${mode === 'api' ? 'API + PostgreSQL · Los cambios se confirman en el servidor.' : 'Demo local · Los cambios se guardan en este navegador.'}</p>
      <form id="nxAssetForm" class="nx-form"><label>Tipo<select name="kind">${options(['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro'],asset.kind)}</select></label>
      <label>Modelo / descripción<input name="brand" required minlength="2" maxlength="100" value="${esc(asset.brand)}"></label>
      <label>Número de serie<input name="serial" required minlength="2" maxlength="70" value="${esc(asset.serial)}"></label>
      <label>Usuario asignado<input name="owner" required minlength="2" maxlength="120" value="${esc(asset.owner)}"></label>
      <label>Ubicación<input name="location" required minlength="2" maxlength="120" value="${esc(asset.location)}"></label>
      <label>Estado<select name="state">${options(['Disponible','Asignado','En reparación','Baja'],asset.state)}</select></label>
      <label>Ticket relacionado<select name="ticketId"><option value="">Sin ticket</option>${hasCurrentTicket && !loadedCurrent ? `<option value="${esc(asset.ticketId)}" selected>#${esc(asset.ticketId)} · Fuera de la bandeja cargada (conservar vínculo)</option>` : ''}${tickets}</select></label>
      <div class="nx-module-status" role="status" aria-live="polite" data-state="ready"><span data-editor-message>Completá los datos y guardá el activo.</span></div>
      <div class="nx-module-actions"><button type="button" class="nx-mini-btn" data-editor-reload hidden>Recargar inventario</button><button type="submit" class="nx-cta">Guardar activo</button></div></form>`;
    const editor = {dialog,state,mode,adapter,opener,open:true};
    state.editor = editor; mountedEditor = editor;
    const live = () => active(mode) && dialog.isConnected && state.editor === editor;
    const form = dialog.querySelector('form');
    const message = dialog.querySelector('[data-editor-message]');
    function editorStatus(text, kind) {
      if (!dialog.isConnected) return;
      message.textContent = text;
      message.parentElement.dataset.state = kind;
      const locked = state.busy || state.requiresReload;
      form.querySelectorAll('input,select,button[type="submit"]').forEach(el => { el.disabled = locked; });
      dialog.querySelector('#nxCloseAsset').disabled = state.busy;
      dialog.querySelector('[data-editor-reload]').hidden = !state.requiresReload;
      dialog.setAttribute('aria-busy',String(state.busy));
    }
    const dismiss = () => { if (!state.busy) closeEditor(editor); };
    dialog.querySelector('#nxCloseAsset').addEventListener('click',dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    });
    dialog.querySelector('[data-editor-reload]').addEventListener('click', () => {
      if (state.busy || !live()) return;
      closeEditor(editor); state.requiresReload = false; state.error = ''; state.notice = 'Inventario recargado para revisar el resultado de la operación anterior.';
      const latest = contexts.get(mode); if (latest) void render(latest.ctx,latest.root);
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!live() || state.busy || state.requiresReload) return;
      const values = new FormData(form);
      const fields = {kind:String(values.get('kind')),brand:String(values.get('brand')).trim(),serial:String(values.get('serial')).trim(),owner:String(values.get('owner')).trim(),location:String(values.get('location')).trim(),state:String(values.get('state')),ticketId:values.get('ticketId') ? Number(values.get('ticketId')) : null};
      state.busy = true; state.error = '';
      editorStatus('Guardando activo… Esperá la confirmación.','pending');
      try {
        await adapter.save(existing ? existing.id : null,fields);
      } catch (err) {
        state.busy = false;
        state.error = err.message || 'No se pudo guardar el activo.';
        if (mode === 'api' && (!err.status || err.status >= 500)) {
          state.requiresReload = true;
          state.error += ' No se pudo confirmar el resultado. Recargá el inventario antes de reintentar; no se guardó una copia demo.';
        }
        if (live()) editorStatus(state.error,'error');
        return;
      }
      state.busy = false; state.loaded = false; state.notice = 'Activo guardado correctamente.'; state.requiresReload = false;
      closeEditor(editor,false,false);
      if (active(mode)) {
        const latest = contexts.get(mode);
        if (latest) void render(latest.ctx,latest.root).then(() => {
          if (active(mode)) latest.root.querySelector('#nxAddAsset:not(:disabled)')?.focus();
        });
        ctx.showToast?.('Activo guardado correctamente.');
      }
    });
    document.body.append(dialog);
    dialog.showModal();
    form.querySelector('[name="brand"]').focus();
  }
  window.NexoAssets = {render};
})();
