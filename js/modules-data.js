/* Assets y Portal: adaptadores separados por origen. Ningún dato API se lee
 * del almacenamiento demo ni se guarda allí como alternativa a una petición. */
(() => {
  'use strict';
  const ASSETS = 'nexodesk-demo-assets-v12';
  const TICKETS = 'nexodesk-demo-tickets-v1';
  const ACTIVITY = 'nexodesk-demo-activity-v12';
  function readArray(key, fallback) {
    const raw = localStorage.getItem(key);
    const value = raw === null ? fallback() : JSON.parse(raw);
    if (!Array.isArray(value)) throw Error('Los datos demo no tienen un formato válido. No se sobrescribieron.');
    return structuredClone(value);
  }
  function track(type, detail) {
    // La actividad auxiliar no debe convertir un guardado confirmado en error
    // ni provocar que el usuario repita un alta que ya se guardó.
    try {
      const events = readArray(ACTIVITY, () => []);
      events.unshift({id:Date.now(),type,detail,date:new Date().toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'})});
      localStorage.setItem(ACTIVITY,JSON.stringify(events.slice(0,50)));
    } catch { /* Los datos principales ya están guardados. */ }
  }
  const api = (path, options) => window.NexoAuth.api(path,options);
  const notFound = message => Object.assign(Error(message),{status:404});
  function assets(mode, ctx) {
    if (mode === 'api') return {
      mode,
      async list() {
        const result = await api('/assets');
        return {items:result.data.map(a => ({...a,id:Number(a.id),ticketId:a.ticketId == null ? null : Number(a.ticketId)})),limit:result.limit ?? 200};
      },
      async save(id, fields) {
        // Payload explícito: no enviar metadatos de UI ni identificadores demo.
        const body = {kind:fields.kind,brand:fields.brand,serial:fields.serial,owner:fields.owner,location:fields.location,state:fields.state,ticketId:fields.ticketId};
        const result = await api(id == null ? '/assets' : `/assets/${Number(id)}`,{method:id == null ? 'POST' : 'PATCH',body:JSON.stringify(body)});
        return {...result.data,id:Number(result.data.id),ticketId:result.data.ticketId == null ? null : Number(result.data.ticketId)};
      }
    };
    if (mode !== 'demo') throw Error('Origen de Assets desconocido');
    const list = () => readArray(ASSETS,() => window.NexoV12.assets());
    return {
      mode,
      async list() { return {items:list(),limit:null}; },
      async save(id, fields) {
        const items = list();
        const pos = id == null ? -1 : items.findIndex(a => String(a.id) === String(id));
        if (id != null && pos < 0) throw notFound('Activo no encontrado');
        if (items.some(a => a.serial.toLowerCase() === fields.serial.toLowerCase() && String(a.id) !== String(id))) {
          throw Object.assign(Error('Ya existe un activo con ese número de serie.'),{status:409});
        }
        const assetId = id ?? `NX-A${String(Math.max(0,...items.map(a => Number(String(a.id).replace('NX-A','')) || 0)) + 1).padStart(3,'0')}`;
        const item = {...(pos < 0 ? {} : items[pos]),...fields,id:assetId};
        if (pos < 0) items.push(item); else items[pos] = item;
        localStorage.setItem(ASSETS,JSON.stringify(items));
        track(pos < 0 ? 'Activo creado' : 'Activo actualizado',`${item.id} · ${item.brand}`);
        return structuredClone(item);
      }
    };
  }
  function portal(mode, ctx, {publicMode = false} = {}) {
    // El punto de entrada público no tiene una vía a datos reales, aunque el
    // mismo navegador tenga una sesión de dashboard abierta.
    if (publicMode) mode = 'demo';
    if (mode === 'api') return {
      mode,
      async list() {
        const result = await api('/portal/my-requests');
        return {items:result.data,limit:result.limit ?? 100};
      },
      async get(id) { return (await api(`/portal/requests/${Number(id)}`)).data; },
      async create(form) {
        // Identidad, prioridad, estado y origen los determina el servidor.
        const body = {type:form.type,title:form.title,description:form.description};
        return (await api('/portal/requests',{method:'POST',body:JSON.stringify(body)})).data;
      }
    };
    if (mode !== 'demo') throw Error('Origen de Portal desconocido');
    // Leer el estado persistido evita sobrescribir una solicitud creada desde
    // el Portal público u otra pestaña mientras el dashboard seguía abierto.
    const tickets = () => readArray(TICKETS,() => publicMode ? [] : ctx.tickets);
    return {
      mode,
      async list() { return {items:tickets(),limit:null}; },
      async get(id) {
        const item = tickets().find(t => String(t.id) === String(id));
        if (!item) throw notFound('No se encontró esa solicitud en este navegador.');
        return item;
      },
      async create(form) {
        const items = tickets();
        const id = Math.max(10300,...items.map(t => Number(t.id) || 0)) + 1;
        const item = {id,title:form.title,description:form.description,type:form.type,priority:form.priority,
          requester:form.requester,assignee:'Sin asignar',status:'Registrado',source:'Portal'};
        items.unshift(item);
        // Confirmar persistencia antes de modificar el estado visible.
        localStorage.setItem(TICKETS,JSON.stringify(items));
        if (!publicMode) ctx.tickets.splice(0,ctx.tickets.length,...items);
        track('Solicitud desde Portal',`#${id} · ${item.title}`);
        window.dispatchEvent(new CustomEvent('nexodesk:tickets-changed'));
        return structuredClone(item);
      }
    };
  }
  window.NexoModulesData = {assets,portal};
})();
