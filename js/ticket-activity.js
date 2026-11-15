/* V2.4.1: presentación de la actividad que conserva el orden del servidor.
 * La iconografía se deriva de los datos; no cambia los tipos persistidos.
 * Nunca escribe auditoría desde
 * el navegador; las notas internas utilizan su endpoint separado. */
(() => {
  'use strict';
  const states = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles = {created:'Ticket creado',updated:'Ticket actualizado',status:'Estado actualizado',
    priority:'Prioridad actualizada',assignee:'Responsable actualizado',test:'Prueba técnica registrada',closed:'Ticket cerrado',
    reopened:'Ticket reabierto',diagnosis:'Diagnóstico de Triage',transfer:'Transferencia de Triage',
    internal_note:'Nota interna',public_comment:'Comentario público'};
  const labels = {title:'Asunto',description:'Descripción',type:'Tipo',priority:'Prioridad',status:'Estado',
    assignee:'Responsable',requester:'Solicitante',category:'Categoría',impact:'Impacto',urgency:'Urgencia',
    diagnosis:'Diagnóstico',level:'Nivel',fromLevel:'Nivel anterior',toLevel:'Nivel de destino',newTest:'Prueba',testDescription:'Prueba registrada'};
  // SVG locales y decorativos: el título y la etiqueta transmiten el significado.
  const paths = {
    created:'<path d="M12 5v14M5 12h14"/>',
    status:'<path d="M20 7h-9M20 7l-3-3M20 7l-3 3M4 17h9M4 17l3-3M4 17l3 3"/>',
    priority:'<path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
    assignee:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 10l2 2 4-4"/>',
    internal_note:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    public_comment:'<path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8Z"/><path d="M7 9h9M7 13h6"/>',
    diagnosis:'<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h6"/>',
    test:'<path d="m8 12 3 3 7-8"/><path d="M21 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h9"/>',
    transfer:'<path d="M12 20V4M5 11l7-7 7 7"/>',
    reopened:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    closed:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    updated:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m13 6 5 5"/>'
  };
  const icon = key => `<svg data-activity-icon="${key}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[key] || paths.updated}</svg>`;
  const fieldIcons = {status:'status',priority:'priority',assignee:'assignee',diagnosis:'diagnosis',testDescription:'test',newTest:'test',level:'transfer'};
  const fieldIcon = key => Object.hasOwn(fieldIcons,key) ? fieldIcons[key] : 'updated';
  function visual(item, keys) {
    if(item.kind==='updated')return keys.length===1 && ['status','priority','assignee'].includes(keys[0]) ? keys[0] : 'updated';
    if(item.kind==='diagnosis' && keys.length && keys.every(key=>['testDescription','newTest'].includes(key)))return 'test';
    return Object.hasOwn(paths,item.kind) ? item.kind : 'updated';
  }
  const dateFormat = new Intl.DateTimeFormat('es-AR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const browserZone = dateFormat.resolvedOptions().timeZone;
  const joinFields = keys => new Intl.ListFormat('es-AR',{style:'long',type:'conjunction'}).format(keys.map(key=>labels[key] || key));
  function valueMarkup(value) {
    if(value==null)return '<span class="nx-change-empty">Sin dato registrado</span>';
    if(value==='')return '<span class="nx-change-empty">Valor vacío</span>';
    const text=typeof value==='object' ? JSON.stringify(value) : String(value);
    return `${typeof value==='string' && !value.trim() ? '<span class="nx-change-empty">Texto en blanco</span>' : ''}<span class="nx-change-value">${esc(text)}</span>`;
  }
  function when(item) {
    if (item.occurredAt && !Number.isNaN(new Date(item.occurredAt).getTime())) {
      return `<time datetime="${esc(item.occurredAt)}" title="Zona horaria del navegador: ${esc(browserZone)}">${esc(dateFormat.format(new Date(item.occurredAt)))}</time>`;
    }
    return item.recordedDate ? `<span>Fecha original: ${esc(item.recordedDate)} · Sin fecha comparable</span>` : '<span>Fecha no documentada</span>';
  }
  function entry(item) {
    const changes = Object.entries(item.changes || {});
    const keys=changes.map(([key])=>key), appearance=visual(item,keys);
    const changeDetails = changes.length ? `<details class="nx-activity-changes"><summary>Ver cambios (${changes.length})</summary><dl>${changes.map(([key,change]) => {
      const values=change && typeof change==='object' ? change : {};
      return `<div class="nx-activity-change"><dt>${icon(fieldIcon(key))}${esc(labels[key] || key)}</dt><dd><div class="nx-change-before"><span class="nx-change-label">Antes</span>${valueMarkup(values.old)}</div><div class="nx-change-after"><span class="nx-change-label">Después</span>${valueMarkup(values.new)}</div></dd></div>`;
    }).join('')}</dl></details>` : '';
    const source = ['ticket','triage','note','comment'].includes(item.source) ? item.source : 'ticket';
    const title=Object.hasOwn(titles,item.kind) || appearance==='test' ? titles[appearance] : 'Actividad registrada';
    const standardText={created:'Ticket creado',updated:'Información del ticket actualizada',closed:'Ticket cerrado',reopened:'Ticket reabierto'};
    const standardSummary={created:'Se registró la creación del ticket.',updated:'Se actualizó la información del ticket.',closed:'Se registró el cierre del ticket.',reopened:'Se registró la reapertura del ticket.'};
    const generatedText=source==='ticket' && Object.hasOwn(standardText,item.kind) && item.text===standardText[item.kind];
    const summary=item.kind==='updated' && keys.length ? `${keys.length===1 ? 'Campo actualizado' : 'Campos actualizados'}: ${joinFields(keys)}.` : generatedText ? standardSummary[item.kind] : '';
    // Solo sustituir mensajes automáticos conocidos. El texto de notas y
    // comentarios nunca se oculta aunque coincida con su título visual.
    const text=generatedText ? '' : item.text;
    return `<li data-activity-id="${esc(item.id)}" data-activity-visual="${appearance}" class="nx-activity-entry nx-activity-${source}"><span class="nx-activity-marker">${icon(appearance)}</span><article class="nx-activity-card">
      <div class="nx-activity-entry-head"><h4 class="nx-activity-title">${esc(title)}</h4><span class="nx-activity-badge">${source === 'note' ? 'Solo personal IT' : source === 'comment' ? 'Público' : source === 'triage' ? 'Triage' : 'Gestión'}</span></div>
      <div class="nx-activity-meta"><span class="nx-activity-author">${esc(item.actor?.name || 'Autor no documentado')}</span>${when(item)}</div>
      ${summary ? `<p class="nx-activity-summary">${esc(summary)}</p>` : ''}${text ? `<p class="nx-activity-description">${esc(text)}</p>` : ''}${item.context?.recordedBeforeV24 ? '<p class="nx-activity-hint">Creación anterior a V2.4. El autor y los valores originales no están documentados.</p>' : ''}${changeDetails}</article></li>`;
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
        <div class="nx-activity-heading"><div><h3 id="ticketActivityTitle">Actividad</h3><p class="nx-activity-hint">Historial del ticket, de más antiguo a más reciente. Las notas internas solo son visibles para el personal IT.</p><p class="nx-activity-timezone">Fechas en la zona horaria de tu navegador: ${esc(browserZone)}.</p></div><button id="refreshTicketActivity" type="button" class="secondary-button" ${s.busy || s.loading ? 'disabled' : ''}>Actualizar actividad</button></div>
        <p class="nx-activity-status" role="status" aria-live="polite" data-state="${s.error ? 'error' : s.busy || s.loading ? 'pending' : 'ready'}">${esc(s.busy ? 'Guardando nota interna…' : s.loading ? 'Cargando actividad…' : s.error || s.notice || 'Actividad actualizada.')}</p>
        <ol class="nx-activity-list" role="list" aria-busy="${s.loading}">${s.items.map(entry).join('')}</ol>
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
