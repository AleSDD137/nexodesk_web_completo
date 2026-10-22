/* Acceso a datos de Triage. La vista comparte un modelo; cada origen conserva
 * su almacenamiento y sus permisos. Los registros API nunca usan localStorage. */
(() => {
  'use strict';
  const KEY = 'nexodesk-triage-v15';
  const clone = value => structuredClone(value);
  const base = () => ({category:'Sin clasificar', impact:'Medio', urgency:'Media', level:'L1', diagnosis:'', tests:[], history:[]});
  const priority = (impact, urgency) => {
    const score = ({Bajo:1, Medio:2, Alto:3}[impact] || 2) * ({Baja:1, Media:2, Alta:3}[urgency] || 2);
    return score >= 6 ? 'Alta' : score >= 3 ? 'Media' : 'Baja';
  };
  function localData() {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('El registro local de Triage no es válido. No se sobrescribió.');
    return data;
  }
  function localRecord(raw) {
    const r = {...base(), ...clone(raw || {})};
    return {...r, tests:r.tests.map((text, id) => ({id, text})),
      history:r.history.slice().reverse().map(e => ({title:e.title, text:e.text, at:e.at}))};
  }
  function apiRecord(raw) {
    return {...raw, level:`L${Number(raw.level)}`,
      tests:raw.tests.map(t => ({id:t.id, text:t.description, at:t.createdAt})),
      history:raw.history.map(e => ({title:e.kind + (e.toLevel ? ` L${e.fromLevel} → L${e.toLevel}` : ''),
        text:e.note + (e.pending ? `\nPróximos pasos: ${e.pending}` : ''), at:e.createdAt}))};
  }
  function create(mode, ctx) {
    if (mode === 'api') {
      const api = (path, options) => window.NexoAuth.api(path, options);
      return {
        mode, canRemoveTests:false,
        async load() {
          const ids = ctx.tickets.map(t => Number(t.id));
          const [summary, people] = await Promise.all([
            ids.length ? api(`/triage/summary?ticketIds=${ids.join(',')}`) : {data:{cases:[]}},
            api('/triage/assignees')
          ]);
          const index = Object.fromEntries(summary.data.cases.map(c => [String(c.ticketId), {level:`L${Number(c.level)}`} ]));
          return {index, people:people.data};
        },
        async get(id) { return apiRecord((await api(`/triage/${Number(id)}`)).data); },
        async save(id, form) {
          return apiRecord((await api(`/triage/${Number(id)}`, {method:'PUT', body:JSON.stringify(form)})).data);
        },
        async transfer(id, form) {
          return apiRecord((await api(`/triage/${Number(id)}/transfer`, {method:'POST', body:JSON.stringify(form)})).data);
        }
      };
    }
    if (mode !== 'demo') throw Error('Origen de Triage desconocido');
    const ticket = id => {
      const t = ctx.tickets.find(t => String(t.id) === String(id));
      if (!t) throw Error('Ticket no encontrado');
      return t;
    };
    // Mantiene el formato V1.5 existente; guardar no importa ni transforma datos API.
    const write = data => localStorage.setItem(KEY, JSON.stringify(data));
    return {
      mode, canRemoveTests:true,
      async load() {
        const data = localData();
        const index = Object.fromEntries(ctx.tickets.filter(t => data[String(t.id)])
          .map(t => [String(t.id), {level:data[String(t.id)].level || 'L1'}]));
        return {index, people:ctx.users.filter(u => u.active && u.role !== 'Solicitante')};
      },
      async get(id) { ticket(id); return localRecord(localData()[String(id)]); },
      async save(id, form) {
        const t = ticket(id), data = localData(), r = {...base(), ...clone(data[String(id)] || {})};
        Object.assign(r, {category:form.category, impact:form.impact, urgency:form.urgency, diagnosis:form.diagnosis});
        if (form.newTest) r.tests.push(form.newTest);
        r.history.push({title:'Diagnóstico actualizado', text:`${r.category} · Impacto ${r.impact} · Urgencia ${r.urgency}. ${r.diagnosis || 'Sin resumen.'}${form.newTest ? ' Prueba: ' + form.newTest : ''}`, at:Date.now()});
        data[String(id)] = r;
        write(data);
        if (form.applyPriority) { t.priority = priority(r.impact, r.urgency); ctx.saveTickets(); }
        return localRecord(r);
      },
      async transfer(id, form) {
        const t = ticket(id), data = localData(), r = {...base(), ...clone(data[String(id)] || {})};
        if (!r.diagnosis.trim() || !r.tests.length) throw Error('Registrá diagnóstico y al menos una prueba antes de transferir.');
        const dest = `L${form.toLevel}`;
        if (![1,2,3].includes(form.toLevel) || r.level === dest) throw Error('Elegí un nivel de destino distinto del actual.');
        const person = form.assigneeUserId === null ? null : ctx.users.find(u => String(u.id) === String(form.assigneeUserId) && u.active && u.role !== 'Solicitante');
        if (form.assigneeUserId !== null && !person) throw Error('Técnico destino inválido');
        r.history.push({title:`Transferencia ${r.level} → ${dest}`, text:`Motivo: ${form.reason}\nPendiente: ${form.pending}`, at:Date.now()});
        r.level = dest; data[String(id)] = r;
        write(data);
        if (person) { t.assignee = person.name; ctx.saveTickets(); }
        return localRecord(r);
      },
      async removeTest(id, testId) {
        ticket(id);
        const data = localData(), r = {...base(), ...clone(data[String(id)] || {})};
        r.tests.splice(Number(testId), 1);
        r.history.push({title:'Prueba eliminada', text:'Se quitó una prueba del listado.', at:Date.now()});
        data[String(id)] = r; write(data);
        return localRecord(r);
      }
    };
  }
  window.NexoTriageData = {create, priority};
})();
