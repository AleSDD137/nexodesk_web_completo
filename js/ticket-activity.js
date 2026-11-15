/* V2.4: la ficha IT lee actividad del servidor. Nunca escribe auditoría desde
 * el navegador; las notas internas utilizan su endpoint separado. */
(() => {
  'use strict';
  const states = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles = {created:'Ticket creado',updated:'Información actualizada',closed:'Ticket cerrado',
    reopened:'Ticket reabierto',diagnosis:'Diagnóstico de Triage',transfer:'Transferencia de Triage',
    internal_note:'Nota interna',public_comment:'Comentario público'};
  const labels = {title:'Asunto',description:'Descripción',type:'Tipo',priority:'Prioridad',status:'Estado',
    assignee:'Responsable',requester:'Solicitante',category:'Categoría',impact:'Impacto',urgency:'Urgencia',
    diagnosis:'Diagnóstico',level:'Nivel',fromLevel:'Nivel anterior',toLevel:'Nivel de destino',newTest:'Prueba',testDescription:'Prueba registrada'};
  const valueText = value => value == null ? 'Sin dato' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function when(item) {
    if (item.occurredAt && !Number.isNaN(new Date(item.occurredAt).getTime())) {
      return `<time datetime="${esc(item.occurredAt)}">${esc(new Date(item.occurredAt).toLocaleString('es-AR'))}</time>`;
    }
    return item.recordedDate ? `<span>Fecha original: ${esc(item.recordedDate)} · Sin fecha comparable</span>` : '<span>Fecha no documentada</span>';
  }
  function entry(item) {
    const changes = Object.entries(item.changes || {});
    const changeDetails = changes.length ? `<details class="nx-activity-changes"><summary>Ver cambios (${changes.length})</summary><dl>${changes.map(([key,change]) => `<div><dt>${esc(labels[key] || key)}</dt><dd><span class="nx-change-label">Antes:</span> ${esc(valueText(change.old))}<br><span class="nx-change-label">Después:</span> ${esc(valueText(change.new))}</dd></div>`).join('')}</dl></details>` : '';
    const source = ['ticket','triage','note','comment'].includes(item.source) ? item.source : 'ticket';
    return `<li data-activity-id="${esc(item.id)}" class="nx-activity-entry nx-activity-${source}"><article>
      <div class="nx-activity-entry-head"><strong>${esc(titles[item.kind] || 'Actividad registrada')}</strong><span class="nx-activity-badge">${source === 'note' ? 'Solo personal IT' : source === 'comment' ? 'Público' : source === 'triage' ? 'Triage' : 'Gestión'}</span></div>
      <div class="nx-activity-meta"><span>${esc(item.actor?.name || 'Autor no documentado')}</span>${when(item)}</div>
      ${item.text ? `<p>${esc(item.text)}</p>` : ''}${item.context?.recordedBeforeV24 ? '<p class="nx-activity-hint">Creación anterior a V2.4. El autor y los valores originales no están documentados.</p>' : ''}${changeDetails}</article></li>`;
  }
  function mount({ticketId, root, dialog}) {
    if (!root) return;
    const auth = window.NexoAuth;
    if (auth?.isSelfService() || auth?.isRequester()) { root.replaceChildren(); return; }
    dialog.classList.add('nx-ticket-activity-dialog');
    const apiMode = window.NexoBridge?.isServer() && ['Administrador','Coordinador','Técnico'].includes(auth?.user?.role);
    if (!apiMode) {
      root.innerHTML = '<section class="nx-ticket-activity"><h3>Actividad</h3><p class="nx-activity-hint">Demo Local conserva los comentarios de este navegador. El historial verificado y las notas internas están disponibles al iniciar sesión con una cuenta IT y utilizar el servidor.</p></section>';
      return;
    }
    const userId = String(auth.user.id);
    const key = `${userId}:${ticketId}`;
    if (!states.has(key)) states.set(key, {items:[],draft:'',busy:false,loading:false,uncertain:false,error:'',notice:'',readVersion:0});
    const s = states.get(key);
    s.root = root; s.dialog = dialog;
    const valid = () => root.isConnected && dialog.open && s.root === root &&
      window.NexoAuth?.source === 'api' && !window.NexoAuth.isSelfService() && String(window.NexoAuth.user?.id) === userId;
    const current = () => s.root?.isConnected && s.dialog?.open && window.NexoAuth?.source === 'api' &&
      !window.NexoAuth.isSelfService() && String(window.NexoAuth.user?.id) === userId;
    let restoreFocus = null;
    function paint() {
      if (!valid()) return;
      root.innerHTML = `<section class="nx-ticket-activity" aria-labelledby="ticketActivityTitle">
        <div class="nx-activity-heading"><div><h3 id="ticketActivityTitle">Actividad</h3><p class="nx-activity-hint">Historial del ticket, de más antiguo a más reciente. Las notas internas solo son visibles para el personal IT.</p></div><button id="refreshTicketActivity" type="button" class="secondary-button" ${s.busy || s.loading ? 'disabled' : ''}>Actualizar actividad</button></div>
        <p class="nx-activity-status" role="status" aria-live="polite" data-state="${s.error ? 'error' : s.busy || s.loading ? 'pending' : 'ready'}">${esc(s.busy ? 'Guardando nota interna…' : s.loading ? 'Cargando actividad…' : s.error || s.notice || 'Actividad actualizada.')}</p>
        <ol class="nx-activity-list" aria-busy="${s.loading}">${s.items.map(entry).join('')}</ol>
        ${!s.items.length && !s.loading ? `<p class="nx-activity-empty">${s.error ? 'La actividad no está disponible. Intentá actualizarla.' : 'No hay actividad documentada para este ticket.'}</p>` : ''}
        <form id="internalNoteForm" class="nx-internal-note-form"><h4>Agregar nota interna</h4><p class="nx-activity-hint" id="internalNoteHelp">Solo para Administrador, Coordinador y Técnicos. No se enviará como comentario público.</p>
        <label for="internalNoteContent">Contenido de la nota</label><textarea id="internalNoteContent" name="content" rows="3" required maxlength="5000" aria-describedby="internalNoteHelp" ${s.busy || s.loading || s.uncertain ? 'disabled' : ''}>${esc(s.draft)}</textarea>
        <button type="submit" class="primary-button" ${s.busy || s.loading || s.uncertain ? 'disabled' : ''}>Guardar nota interna</button></form></section>`;
      root.querySelector('#refreshTicketActivity').addEventListener('click',() => { restoreFocus = 'refreshTicketActivity'; void load(true); });
      root.querySelector('[name=content]').addEventListener('input',event => { s.draft = event.target.value; });
      root.querySelector('#internalNoteForm').addEventListener('submit',async event => {
        event.preventDefault();
        if (!valid() || s.busy || s.loading || s.uncertain) return;
        s.draft = String(new FormData(event.target).get('content'));
        const content = s.draft.trim();
        if (!content || content.length > 5000) { s.error = 'Escribí una nota de entre 1 y 5000 caracteres, sin dejar solo espacios.'; paint(); return; }
        s.busy = true; s.error = ''; s.notice = ''; paint();
        try {
          await auth.api(`/tickets/${Number(ticketId)}/notes`,{method:'POST',body:JSON.stringify({content})});
          // Una nota confirmada nunca se reenvía si falla la lectura siguiente.
          s.draft = ''; s.notice = 'Nota interna guardada.';
        } catch (error) {
          s.uncertain = !error.status || error.status >= 500;
          s.error = s.uncertain ? 'No se pudo confirmar el resultado. Actualizá la actividad y comprobá si la nota ya aparece antes de reintentar.' : error.message || 'No se pudo guardar la nota interna.';
        } finally { s.busy = false; }
        if (current()) mount({ticketId,root:s.root,dialog:s.dialog});
      });
      if (restoreFocus && !s.loading && !s.busy) {
        const target=root.querySelector(`#${restoreFocus}`);
        if (target && !target.disabled && (document.activeElement===document.body || root.contains(document.activeElement)))target.focus({preventScroll:true});
        restoreFocus=null;
      }
    }
    async function load(explicit=false) {
      if (s.busy || s.loading) return;
      const version = ++s.readVersion;
      s.loading = true;
      const previousError = s.error;
      if (explicit) s.error = '';
      paint();
      try {
        const result = await auth.api(`/tickets/${Number(ticketId)}/activity`);
        if (version !== s.readVersion) return;
        if (!Array.isArray(result.data)) throw Error('El servidor devolvió un historial inválido.');
        s.items = result.data;
        if (explicit) { s.uncertain = false; s.error = ''; }
      } catch (error) {
        if (version === s.readVersion) s.error = previousError || error.message || 'No se pudo cargar la actividad.';
      } finally {
        if (version === s.readVersion) s.loading = false;
        if (valid()) paint();
      }
    }
    // Una escritura pendiente conserva el estado aunque se cierre y reabra la
    // ficha. Las lecturas viejas no pueden reemplazar la actividad de otra ficha.
    if (!s.busy) { s.loading = false; ++s.readVersion; }
    paint();
    if (!s.busy && !s.uncertain) void load();
  }
  window.NexoTicketActivity = {mount};
})();
