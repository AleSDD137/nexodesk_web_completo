import type {ReportData} from './reports.js';

/** Spreadsheet formulas must remain text, including leading whitespace/control chars. */
export function reportCsvCell(value:unknown):string {
  let text=value==null?'':String(value);
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function reportCsv(report:ReportData):string {
  const rows:unknown[][]=[['Sección','Indicador','Valor','Alcance'],['Metadatos','Generado',report.generatedAt,'UTC'],
    ['Metadatos','Filtros',JSON.stringify(report.scope.filters),'Campos actuales; fechas UTC'],
    ...Object.entries(report.totals).map(([key,value])=>['Totales',key,value,'Cohortes documentadas en NEXODESK_V2_9.md']),
    ...report.byPriority.map(r=>['Prioridad',r.label,r.count,'Cohorte de creación completa']),
    ...report.byStatus.map(r=>['Estado',r.label,r.count,'Cohorte de creación completa']),
    ...report.byCategory.map(r=>['Categoría',r.label,r.count,'Cohorte de creación completa']),
    ...report.workload.flatMap(r=>[['Responsable',r.assignee,r.total,'Tickets actuales; máximo '+report.workloadLimit+' de '+report.workloadGroups+' grupos'],['Responsable abierto',r.assignee,r.open,'Cohorte de creación']]),
    ...report.interventions.map(r=>['Intervenciones documentadas',`#${r.userId} ${r.name}`,r.tickets,'Tickets distintos; máximo 100 de '+report.interventionGroups+' actores']),
    ...Object.entries(report.escalations).map(([k,v])=>['Triage',k,v,'Niveles actuales; transferencias por fecha de evento']),
    ...report.trends.flatMap(r=>[['Tendencia creada',r.day,r.created,'Últimos '+report.trendLimit+' de '+report.trendDays+' días con actividad'],['Tendencia cierres',r.day,r.resolved,'Eventos de cierre, pueden repetirse por ticket']]),
    ...report.recurrence.groups.map(r=>['Títulos de incidentes repetidos',r.title,r.count,'Máximo 50 de '+report.recurrence.totalGroups+' grupos; no confirma causa']),
    ['Assets','Total',report.assets.total,report.assets.scope],['Assets','Vinculados',report.assets.linked,report.assets.scope],
    ...report.assets.byState.map(r=>['Assets estado',r.label,r.count,report.assets.scope]),
    ...report.assets.locations.map(r=>['Assets ubicación',r.label,r.count,'Máximo 100 de '+report.assets.locationGroups+' grupos']),
    ...Object.entries(report.sla).map(([k,v])=>['SLA',k,typeof v==='object'?JSON.stringify(v):v,'Mediciones disponibles'])];
  return '\uFEFF'+rows.map(row=>row.map(reportCsvCell).join(',')).join('\r\n')+'\r\n';
}
