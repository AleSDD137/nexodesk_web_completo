/* Pulse V2.5: el adaptador API nunca lee datos Demo ni realiza un fallback.
 * La demo conserva sus registros originales, sin inventar fechas o autores. */
(() => {
  'use strict';
  const states=['Registrado','En revisión','En atención','Validación','Cerrado'];
  const priorities=['Baja','Media','Alta','Crítica'];
  const unknownDate = value => {
    if(typeof value==='number' && Number.isFinite(value))return new Date(value).toISOString();
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
    const at=Date.parse(value);return Number.isFinite(at)?new Date(at).toISOString():null;
  };
  const unassigned = t => !String(t.assignee??'').trim() || t.assignee==='Sin asignar';
  const within = (at,filters) => !filters.from&&!filters.to || !!at &&
    (!filters.from || at>=filters.from+'T00:00:00.000Z') && (!filters.to || at<new Date(Date.parse(filters.to+'T00:00:00Z')+86400000).toISOString());
  function readTriage(){
    const data=JSON.parse(localStorage.getItem('nexodesk-triage-v15')||'{}');
    if(!data || typeof data!=='object' || Array.isArray(data))throw Error('El Triage Demo no tiene un formato válido. No se modificó.');
    return data;
  }
  function query(filters,extra={}){
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries({...filters,...extra}))if(value!=='' && value!=null)params.set(key,String(value));
    const text=params.toString();return text?'?'+text:'';
  }
  function create(mode,ctx){
    if(mode==='api')return {
      mode,
      async summary(filters={}){return (await window.NexoAuth.api('/pulse/summary'+query(filters))).data;},
      async activity(filters={},cursor=null){return window.NexoAuth.api('/pulse/activity'+query(filters,{limit:20,cursor}));}
    };
    if(mode!=='demo')throw Error('Origen de Pulse desconocido');
    const tickets=()=>{
      if(!Array.isArray(ctx.tickets))throw Error('Los tickets Demo no tienen un formato válido.');
      return ctx.tickets;
    };
    return {
      mode,
      async summary(filters={}){
        const all=tickets(),items=all.filter(t=>within(unknownDate(t.createdAt),filters)),triage=readTriage();
        const open=items.filter(t=>t.status!=='Cerrado');
        const groups=new Map();
        for(const t of items){
          if(unassigned(t))continue;
          if(!groups.has(t.assignee))groups.set(t.assignee,{assignee:t.assignee,total:0,open:0,closed:0});
          const g=groups.get(t.assignee);g.total++;g[t.status==='Cerrado'?'closed':'open']++;
        }
        const workload=[...groups.values()].sort((a,b)=>b.open-a.open||b.total-a.total||a.assignee.localeCompare(b.assignee,'es'));
        return {generatedAt:new Date().toISOString(),scope:{from:filters.from||null,to:filters.to||null,ticketBasis:'created_at',
          unassignedBasis:'open_tickets',undatedTickets:all.filter(t=>!unknownDate(t.createdAt)).length},
          totals:{total:items.length,open:open.length,inProgress:items.filter(t=>t.status==='En atención').length,
            validation:items.filter(t=>t.status==='Validación').length,closed:items.filter(t=>t.status==='Cerrado').length,
            unassigned:open.filter(unassigned).length},
          byStatus:states.map(status=>({status,count:items.filter(t=>t.status===status).length})),
          byPriority:priorities.map(priority=>({priority,count:items.filter(t=>t.priority===priority).length})),
          workload:workload.slice(0,50),workloadLimit:50,totalWorkloadGroups:workload.length,
          escalated:{l2:items.filter(t=>String(triage[String(t.id)]?.level)==='L2').length,
            l3:items.filter(t=>String(triage[String(t.id)]?.level)==='L3').length}};
      },
      async activity(filters={},cursor=null){
        const items=[],triage=readTriage(),all=tickets();
        for(const t of all){
          const history=triage[String(t.id)]?.history;
          if(!Array.isArray(history))continue;
          history.forEach((e,index)=>{
            if(!e || typeof e!=='object')return;
            const at=unknownDate(e.at);
            if(!within(at,filters))return;
            const transfer=typeof e.title==='string'&&e.title.startsWith('Transferencia');
            const levels=transfer?/L([123])\s*→\s*L([123])/.exec(e.title):null;
            items.push({id:`demo-triage:${t.id}:${index}`,source:'triage',ticketId:t.id,title:t.title,
              kind:transfer?'transfer':'diagnosis',occurredAt:at,recordedDate:typeof e.at==='string'?e.at:'',
              actorName:null,changes:{},fromLevel:levels?Number(levels[1]):null,toLevel:levels?Number(levels[2]):null});
          });
        }
        const legacy=window.NexoV12?.activity?.()||[];
        if(!Array.isArray(legacy))throw Error('La actividad Demo no tiene un formato válido.');
        legacy.forEach((e,index)=>{
          if(!e || typeof e!=='object')return;
          const at=unknownDate(e.date);if(!within(at,filters))return;
          const match=typeof e.detail==='string'?/^#(\d+)\b/.exec(e.detail):null;
          const t=match?all.find(t=>String(t.id)===match[1]):null;
          items.push({id:`demo-activity:${e.id??index}:${index}`,source:'demo',ticketId:t?.id??null,
            title:t?.title||e.type||'Actividad local',kind:e.type==='Solicitud desde Portal'?'created':'local_activity',
            occurredAt:at,recordedDate:typeof e.date==='string'?e.date:'',actorName:null,changes:{}});
        });
        items.sort((a,b)=>a.occurredAt===b.occurredAt?a.id.localeCompare(b.id):a.occurredAt===null?1:b.occurredAt===null?-1:a.occurredAt>b.occurredAt?-1:1);
        const offset=cursor==null?0:Number(cursor);
        if(!Number.isSafeInteger(offset)||offset<0)throw Error('Página Demo inválida');
        const data=items.slice(offset,offset+20),hasMore=offset+20<items.length;
        return {data,nextCursor:hasMore?String(offset+20):null,hasMore,generatedAt:new Date().toISOString()};
      }
    };
  }
  window.NexoPulseData={create};
})();
