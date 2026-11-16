/* SLA data sources: API errors never fall back to local Demo records. */
(()=>{'use strict';
 const KEY='nexodesk-demo-sla-v27',weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const defaults=()=>['Crítica','Alta','Media','Baja'].map((priority,i)=>({priority,responseMinutes:[30,60,240,480][i],resolutionMinutes:[240,480,1080,2160][i],timezone:'America/Argentina/Buenos_Aires',weekdays:[1,2,3,4,5],startMinute:540,endMinute:1080,warningMinutes:30,escalationEnabled:false,escalationLevel:2,enabled:true}));
 const read=()=>{const raw=localStorage.getItem(KEY);const data=raw?JSON.parse(raw):{policies:defaults(),records:{},alerts:[]};if(!Array.isArray(data.policies)||!data.records||typeof data.records!=='object'||Array.isArray(data.records)||!Array.isArray(data.alerts))throw Error('Datos SLA Demo inválidos; no se sobrescribieron.');return data;};
 const validate=p=>{const span=p.endMinute-p.startMinute,days=p.weekdays;
  new Intl.DateTimeFormat('en',{timeZone:p.timezone});
  if(!Array.isArray(days)||!days.length||new Set(days).size!==days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6)||span<60||p.startMinute<0||p.endMinute>1440||p.responseMinutes<1||p.resolutionMinutes<p.responseMinutes||p.resolutionMinutes>10080||p.resolutionMinutes>span*days.length*4)throw Error('Política SLA Demo inválida. Revisá duración, calendario y zona horaria.');
 };
 const save=data=>localStorage.setItem(KEY,JSON.stringify(data));
 const deadline=(start,minutes,p)=>{
  const f=new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let at=Math.ceil(start/60000)*60000,left=minutes,cap=at+366*86400000;
  for(;left&&at<cap;at+=60000){const parts=f.formatToParts(at),v=k=>parts.find(x=>x.type===k)?.value,minute=Number(v('hour'))*60+Number(v('minute'));
   if(p.weekdays.includes(weekdays.indexOf(v('weekday')))&&minute>=p.startMinute&&minute<p.endMinute)left--;}
  if(left)throw Error('Objetivo SLA fuera del calendario admitido.');return new Date(at).toISOString();
 };
 const state=r=>({...r,responseState:r.firstResponseAt?(r.firstResponseAt<=r.responseDueAt?'met':'breached'):Date.parse(r.responseDueAt)<Date.now()?'overdue':'pending',resolutionState:r.resolvedAt?(r.resolvedAt<=r.resolutionDueAt?'met':'breached'):Date.parse(r.resolutionDueAt)<Date.now()?'overdue':'pending'});
 function create(mode,ctx){
  if(mode==='api'){const api=(path,opt)=>window.NexoAuth.api('/sla'+path,opt),query=v=>'?' + new URLSearchParams(Object.entries(v).filter(([,x])=>x!==''&&x!=null));return {
   policies:()=>api('/policies'),update:(p,data)=>api('/policies/'+encodeURIComponent(p),{method:'PUT',body:JSON.stringify(data)}),
   tickets:q=>api('/tickets'+query(q)),alerts:q=>api('/alerts'+query(q)),
   check:q=>api('/check',{method:'POST',body:JSON.stringify(q)}),ack:id=>api(`/alerts/${Number(id)}/acknowledge`,{method:'POST',body:'{}'})
  };}
  if(mode!=='demo')throw Error('Origen SLA inválido');
  return {
   async policies(){return {data:read().policies};},
   async update(priority,p){validate(p);const d=read();d.policies=d.policies.map(x=>x.priority===priority?{...p,priority}:x);save(d);return {data:{...p,priority}};},
   async tickets(q={}){const d=read(),all=Object.values(d.records).map(state).filter(r=>(!q.priority||r.priority===q.priority)&&(!q.status||(q.status==='overdue'?[r.responseState,r.resolutionState].includes('overdue'):q.status==='met'?r.responseState==='met'&&r.resolutionState==='met':q.status==='breached'?[r.responseState,r.resolutionState].includes('breached')&&! [r.responseState,r.resolutionState].includes('overdue'):![r.responseState,r.resolutionState].includes('overdue')&&![r.responseState,r.resolutionState].includes('breached')&&!(r.responseState==='met'&&r.resolutionState==='met')))).sort((a,b)=>a.resolutionDueAt.localeCompare(b.resolutionDueAt));const offset=q.offset||0;return {data:all.slice(offset,offset+20),total:all.length,scope:'Demo identificada: seguimiento desde su inscripción local, sin inferir fechas históricas.'};},
   async alerts(q={}){const all=read().alerts.slice().reverse(),offset=q.offset||0;return {data:all.slice(offset,offset+30)};},
   async check(){const d=read(),now=new Date().toISOString();let enrolled=0,alertsCreated=0;
    for(const t of ctx.tickets||[]){let r=d.records[t.id];if(r){r.title=t.title;r.priority=t.priority;r.status=t.status;}if(t.status==='Cerrado')continue;
     if(!r){const p=d.policies.find(p=>p.priority===t.priority&&p.enabled);if(!p)continue;r=d.records[t.id]={id:t.id,title:t.title,priority:t.priority,status:t.status,startedAt:now,responseDueAt:deadline(Date.now(),p.responseMinutes,p),resolutionDueAt:deadline(Date.now(),p.resolutionMinutes,p),firstResponseAt:null,resolvedAt:null,cycle:1,policy:structuredClone(p)};enrolled++;}
     for(const [kind,at,done] of [['response',r.responseDueAt,r.firstResponseAt],['resolution',r.resolutionDueAt,r.resolvedAt]]){if(done)continue;const left=Date.parse(at)-Date.now(),tag=left<=0?kind+'_breach':left<=r.policy.warningMinutes*60000?kind+'_warning':null;
      if(tag&&!d.alerts.some(a=>a.ticketId===t.id&&a.cycle===r.cycle&&a.kind===tag)){d.alerts.push({id:crypto.randomUUID(),ticketId:t.id,title:t.title,kind:tag,cycle:r.cycle,createdAt:now});alertsCreated++;}}
     if(r.policy.escalationEnabled&&d.alerts.some(a=>a.ticketId===t.id&&a.cycle===r.cycle&&a.kind.endsWith('_breach'))&&!d.alerts.some(a=>a.ticketId===t.id&&a.cycle===r.cycle&&a.kind==='escalation')){d.alerts.push({id:crypto.randomUUID(),ticketId:t.id,title:t.title,kind:'escalation',targetLevel:r.policy.escalationLevel,cycle:r.cycle,createdAt:now});alertsCreated++;}
    }save(d);return {data:{processed:(ctx.tickets||[]).length,enrolled,alertsCreated,nextAfter:null}};
   },async ack(id){const d=read(),a=d.alerts.find(a=>a.id===id);if(!a)throw Error('Alerta no encontrada');a.acknowledgedAt??=new Date().toISOString();a.acknowledgedBy??='Usuario Demo';save(d);return {data:a};}
  };
 }
 function onDemoTicketsSaved(tickets){
  const d=read(),now=new Date().toISOString();let changed=false;
  for(const t of tickets){const r=d.records[t.id];if(!r)continue;
   if(t.status==='Cerrado'&&r.status!=='Cerrado')r.resolvedAt=now;
   else if(t.status!=='Cerrado'&&r.status==='Cerrado'){r.resolvedAt=null;r.cycle++;}
   r.status=t.status;r.priority=t.priority;r.title=t.title;changed=true;
  }if(changed)save(d);
 }
 function onDemoPublicComment(ticketId){const d=read(),r=d.records[ticketId];if(r&&!r.firstResponseAt){r.firstResponseAt=new Date().toISOString();save(d);}}
 window.NexoSlaData={create,demoRecords:()=>Object.values(read().records).map(state),onDemoTicketsSaved,onDemoPublicComment};
})();
