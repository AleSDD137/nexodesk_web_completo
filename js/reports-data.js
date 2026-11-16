/* V2.9: la API calcula cohortes completas; Demo nunca usa datos del servidor. */
(()=>{'use strict';
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const within=(value,f)=>!f.from&&!f.to||!!value&&(!f.from||value>=f.from+'T00:00:00.000Z')&&(!f.to||value<new Date(Date.parse(f.to+'T00:00:00Z')+86400000).toISOString());
const groups=(items,key)=>{const m=new Map();for(const item of items){const label=String(key(item));m.set(label,(m.get(label)||0)+1);}return [...m].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));};
const query=f=>{const p=new URLSearchParams();for(const [k,v] of Object.entries(f))if(v)p.set(k,v);return '?'+p;};
const cell=value=>{let s=value==null?'':String(value);if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
function csv(d){const rows=[['Sección','Indicador','Valor','Alcance'],['Metadatos','Origen','Demo Local','Solo navegador'],['Metadatos','Filtros',JSON.stringify(d.scope.filters),'Fechas UTC'],...Object.entries(d.totals).map(([k,v])=>['Totales',k,v,'Datos locales documentados']),...d.byPriority.map(r=>['Prioridad',r.label,r.count,'Cohorte local']),...d.byStatus.map(r=>['Estado',r.label,r.count,'Cohorte local']),...d.byCategory.map(r=>['Categoría',r.label,r.count,'Cohorte local']),...d.workload.map(r=>['Responsable',r.assignee,r.total,'Actual; no intervenciones históricas']),...d.trends.map(r=>['Creación',r.day,r.created,'Solo fechas documentadas']),...d.assets.byState.map(r=>['Assets',r.label,r.count,'Todo el inventario local']),['SLA','Disponible',false,'Consultar panel SLA Demo; sin métricas históricas inferidas']];return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';}
function create(mode,ctx){
 if(mode==='api')return {async summary(f){return(await window.NexoAuth.api('/reports/summary'+query(f))).data;},async export(f){return window.NexoAuth.api('/reports/export'+query(f));}};
 if(mode!=='demo')throw Error('Origen de reportes inválido');
 async function summary(f={}){
  const raw=localStorage.getItem('nexodesk-triage-v15'),triage=raw===null?{}:JSON.parse(raw);
  if(!triage||typeof triage!=='object'||Array.isArray(triage))throw Error('El Triage Demo no tiene formato válido.');
  const all=ctx.tickets.filter(t=>(!f.assignee||t.assignee===f.assignee)&&(!f.category||(triage[t.id]?.category||'Sin clasificar')===f.category)&&(!f.priority||t.priority===f.priority)&&(!f.status||t.status===f.status));
  const cohort=all.filter(t=>within(iso(t.createdAt),f)),assets=window.NexoV12.assets();
  const loads=groups(cohort,t=>t.assignee||'Sin asignar').map(r=>({assignee:r.label,total:r.count,open:cohort.filter(t=>(t.assignee||'Sin asignar')===r.label&&t.status!=='Cerrado').length,closed:cohort.filter(t=>(t.assignee||'Sin asignar')===r.label&&t.status==='Cerrado').length}));
  const recurrence=groups(cohort.filter(t=>t.type==='Incidente'),t=>String(t.title).trim().replace(/\s+/g,' ').toLocaleLowerCase('es')).filter(g=>g.count>1);
  const trends=groups(cohort.filter(t=>iso(t.createdAt)),t=>iso(t.createdAt).slice(0,10)).map(r=>({day:r.label,created:r.count,resolved:0,events:0})).sort((a,b)=>a.day.localeCompare(b.day));
  const locations=groups(assets,a=>a.location);
  return {generatedAt:new Date().toISOString(),scope:{filters:f,ticketBasis:'created_at',timezone:'UTC',undatedTickets:all.filter(t=>!iso(t.createdAt)).length},
   totals:{created:cohort.length,open:cohort.filter(t=>t.status!=='Cerrado').length,pending:cohort.filter(t=>['Registrado','En revisión','Validación'].includes(t.status)).length,closedSnapshot:cohort.filter(t=>t.status==='Cerrado').length,resolved:null,closureEvents:null,firstResponseSamples:0,avgFirstResponseMinutes:null,resolutionSamples:0,avgResolutionMinutes:null},
   byPriority:groups(cohort,t=>t.priority),byStatus:groups(cohort,t=>t.status),byCategory:groups(cohort,t=>triage[t.id]?.category||'Sin clasificar'),workload:loads.slice(0,100),workloadGroups:loads.length,workloadLimit:100,interventions:[],interventionGroups:0,interventionLimit:100,
   escalations:{l1:cohort.filter(t=>!triage[t.id]?.level||triage[t.id]?.level==='L1').length,l2:cohort.filter(t=>triage[t.id]?.level==='L2').length,l3:cohort.filter(t=>triage[t.id]?.level==='L3').length,transfers:null},
   recurrence:{groups:recurrence.slice(0,50).map(r=>({title:r.label,count:r.count})),totalGroups:recurrence.length,limit:50,basis:'Títulos de incidentes idénticos normalizados; no causa confirmada'},
   trends:trends.slice(-366),trendDays:trends.length,trendLimit:366,
   assets:{total:assets.length,linked:assets.filter(a=>a.ticketId).length,byState:groups(assets,a=>a.state),locations:locations.slice(0,100),locationGroups:locations.length,locationLimit:100,scope:'Todo el inventario Demo, sin aplicar filtros de tickets'},
   sla:{available:false,reason:'Los datos locales previos no documentan mediciones históricas SLA.'}};
 }
 return {summary,async export(f){return {filename:'nexodesk-reportes-demo.csv',mime:'text/csv;charset=utf-8',content:csv(await summary(f))};}};
}
window.NexoReportsData={create};
})();
