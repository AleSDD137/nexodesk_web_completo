/** V2.9 reports: PostgreSQL aggregates over complete, explicitly named cohorts. */
import type {Express,Request,Response,RequestHandler} from 'express';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {requireAuth,requireRole,MANAGERS} from './auth.js';
import {transaction} from './ticket-audit.js';
import {reportCsv} from './reports-format.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>value.slice(0,4)!=='0000'&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'Fecha inválida');
export const reportFilters=z.object({from:day.optional(),to:day.optional(),assignee:z.string().trim().max(120).optional(),
  category:z.string().trim().max(60).optional(),priority:z.enum(['Baja','Media','Alta','Crítica']).optional(),
  status:z.enum(['Registrado','En revisión','En atención','Validación','Cerrado']).optional()}).strict()
  .refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'Período inválido'});
export type ReportFilters=z.infer<typeof reportFilters>;
const values=(f:ReportFilters)=>[f.from??null,f.to??null,f.assignee||null,f.category||null,f.priority??null,f.status??null];
const period=(column:string)=>`($1::date IS NULL OR ${column}>=($1::date::timestamp AT TIME ZONE 'UTC'))
  AND ($2::date IS NULL OR ${column}<(($2::date+1)::timestamp AT TIME ZONE 'UTC'))`;
const selected=`WITH selected AS (
  SELECT t.*,COALESCE(c.category,'Sin clasificar') AS category,COALESCE(c.level,1) AS level
  FROM tickets t LEFT JOIN triage_cases c ON c.ticket_id=t.id
  WHERE ($3::text IS NULL OR t.assignee=$3) AND ($4::text IS NULL OR COALESCE(c.category,'Sin clasificar')=$4)
    AND ($5::text IS NULL OR t.priority=$5) AND ($6::text IS NULL OR t.status=$6)
), cohort AS (SELECT * FROM selected WHERE ${period('created_at')})`;

type Group={label:string;count:number};
export interface ReportData {
  generatedAt:string; scope:{filters:ReportFilters;ticketBasis:string;resolvedBasis:string;timingsBasis:string;timezone:string};
  totals:{created:number;open:number;pending:number;closedSnapshot:number;resolved:number;closureEvents:number;
    firstResponseSamples:number;avgFirstResponseMinutes:number|null;resolutionSamples:number;avgResolutionMinutes:number|null};
  byPriority:Group[];byStatus:Group[];byCategory:Group[];
  workload:{assignee:string;total:number;open:number;closed:number}[];
  workloadGroups:number;workloadLimit:number;
  interventions:{userId:string;name:string;tickets:number;events:number}[];interventionGroups:number;interventionLimit:number;
  escalations:{l1:number;l2:number;l3:number;transfers:number};
  recurrence:{groups:{title:string;count:number}[];totalGroups:number;limit:number;basis:string};
  trends:{day:string;created:number;resolved:number;events:number}[];trendDays:number;trendLimit:number;
  assets:{total:number;linked:number;byState:Group[];locations:{label:string;count:number}[];locationGroups:number;locationLimit:number;scope:string};
  sla:Record<string,unknown>;
}

export async function collectReport(client:PoolClient,filters:ReportFilters):Promise<ReportData> {
  const params=values(filters);
  const clock=await client.query<{at:string}>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`);
  const totals=await client.query<ReportData['totals']>(`${selected}, response AS (
    SELECT s.ticket_id,s.first_response_at AS at,s.started_at AS baseline FROM ticket_sla s JOIN cohort t ON t.id=s.ticket_id
    WHERE s.first_response_at IS NOT NULL AND s.first_response_at>=s.started_at
  ), closure AS (
    SELECT e.ticket_id,max(e.occurred_at) AS at FROM ticket_events e JOIN cohort t ON t.id=e.ticket_id
    WHERE e.kind='closed' AND e.occurred_at>=t.created_at GROUP BY e.ticket_id
  ), resolutions AS (
    SELECT e.ticket_id,count(*)::int AS n FROM ticket_events e JOIN selected t ON t.id=e.ticket_id
    WHERE e.kind='closed' AND ${period('e.occurred_at')} GROUP BY e.ticket_id
  ) SELECT count(*)::int AS created,count(*) FILTER(WHERE t.status<>'Cerrado')::int AS open,
    count(*) FILTER(WHERE t.status IN ('Registrado','En revisión','Validación'))::int AS pending,
    count(*) FILTER(WHERE t.status='Cerrado')::int AS "closedSnapshot",
    (SELECT count(*)::int FROM resolutions) AS resolved,
    (SELECT COALESCE(sum(n),0)::int FROM resolutions) AS "closureEvents",
    count(r.at)::int AS "firstResponseSamples",
    round(avg(EXTRACT(epoch FROM(r.at-r.baseline))/60)::numeric,2)::float8 AS "avgFirstResponseMinutes",
    count(c.at) FILTER(WHERE t.status='Cerrado')::int AS "resolutionSamples",
    round(avg(EXTRACT(epoch FROM(c.at-t.created_at))/60) FILTER(WHERE t.status='Cerrado')::numeric,2)::float8 AS "avgResolutionMinutes"
    FROM cohort t LEFT JOIN response r ON r.ticket_id=t.id LEFT JOIN closure c ON c.ticket_id=t.id`,params);
  async function distribution(column:'priority'|'status'|'category'){
    return (await client.query<Group>(`${selected} SELECT ${column} AS label,count(*)::int AS count FROM cohort GROUP BY ${column} ORDER BY count DESC,${column}`,params)).rows;
  }
  const byPriority=await distribution('priority'),byStatus=await distribution('status'),byCategory=await distribution('category');
  const workload=await client.query<{assignee:string;total:number;open:number;closed:number;groups:number}>(`${selected}
    SELECT assignee,count(*)::int AS total,count(*) FILTER(WHERE status<>'Cerrado')::int AS open,
      count(*) FILTER(WHERE status='Cerrado')::int AS closed,count(*) OVER()::int AS groups
    FROM cohort GROUP BY assignee ORDER BY total DESC,assignee LIMIT 100`,params);
  const interventions=await client.query<{userId:string;name:string;tickets:number;events:number;groups:number}>(`${selected}, raw_comments AS (
    SELECT t.id AS ticket_id,c->>'authorId' AS actor,c->>'date' AS stamp FROM selected t
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t.comments)='array' THEN t.comments ELSE '[]'::jsonb END) c
  ), formatted_comments AS (
    SELECT ticket_id,actor,CASE WHEN stamp ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$' THEN stamp ELSE NULL END AS stamp FROM raw_comments
  ), safe_comments AS (
    SELECT ticket_id,actor,CASE
      WHEN stamp IS NOT NULL
        AND substring(stamp,1,4)::int BETWEEN 1 AND 9999 AND substring(stamp,6,2)::int BETWEEN 1 AND 12
        AND substring(stamp,12,2)::int BETWEEN 0 AND 23 AND substring(stamp,15,2)::int BETWEEN 0 AND 59
        AND substring(stamp,18,2)::int BETWEEN 0 AND 59 THEN
          CASE WHEN substring(stamp,9,2)::int BETWEEN 1 AND EXTRACT(day FROM
            make_date(substring(stamp,1,4)::int,substring(stamp,6,2)::int,1)+interval '1 month - 1 day')
            THEN stamp::timestamptz ELSE NULL END
      ELSE NULL END AS at FROM formatted_comments
  ), actions AS (
    SELECT e.ticket_id,e.actor_id::text AS actor,e.occurred_at AS at FROM ticket_events e JOIN selected t ON t.id=e.ticket_id
    UNION ALL SELECT e.ticket_id,e.created_by::text,e.created_at FROM triage_events e JOIN selected t ON t.id=e.ticket_id
    UNION ALL SELECT ticket_id,actor,at FROM safe_comments
  ) SELECT u.id::text AS "userId",u.name,count(DISTINCT a.ticket_id)::int AS tickets,
    count(*)::int AS events,count(*) OVER()::int AS groups FROM actions a JOIN users u ON u.id::text=a.actor
    WHERE u.role IN ('Administrador','Coordinador','Técnico') AND ${period('a.at')}
    GROUP BY u.id,u.name ORDER BY tickets DESC,events DESC,u.id LIMIT 100`,params);
  const levels=await client.query<ReportData['escalations']>(`${selected} SELECT
    count(*) FILTER(WHERE level=1)::int AS l1,count(*) FILTER(WHERE level=2)::int AS l2,
    count(*) FILTER(WHERE level=3)::int AS l3,(SELECT count(*)::int FROM triage_events e JOIN selected t ON t.id=e.ticket_id
    WHERE e.kind='Transferencia' AND ${period('e.created_at')}) AS transfers FROM cohort`,params);
  const recurrent=await client.query<{title:string;count:number;groups:number}>(`${selected}
    SELECT lower(regexp_replace(btrim(title),'\\s+',' ','g')) AS title,count(*)::int AS count,count(*) OVER()::int AS groups
    FROM cohort WHERE type='Incidente' GROUP BY lower(regexp_replace(btrim(title),'\\s+',' ','g')) HAVING count(*)>1
    ORDER BY count DESC,title LIMIT 50`,params);
  const trends=await client.query<{day:string;created:number;resolved:number;events:number;days:number}>(`${selected}, daily AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day,1 AS created,0 AS resolved,0 AS events FROM cohort
    UNION ALL SELECT (e.occurred_at AT TIME ZONE 'UTC')::date,0,CASE WHEN e.kind='closed' THEN 1 ELSE 0 END,1
      FROM ticket_events e JOIN selected t ON t.id=e.ticket_id WHERE ${period('e.occurred_at')}
  ) SELECT day::text,count(*) OVER()::int AS days,sum(created)::int AS created,sum(resolved)::int AS resolved,
    sum(events)::int AS events FROM daily GROUP BY day ORDER BY day DESC LIMIT 366`,params);
  const assetTotals=await client.query<{total:number;linked:number}>(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE ticket_id IS NOT NULL OR EXISTS(SELECT 1 FROM asset_ticket_links l WHERE l.asset_id=assets.id))::int AS linked FROM assets`);
  const assetStates=await client.query<Group>('SELECT state AS label,count(*)::int AS count FROM assets GROUP BY state ORDER BY state');
  const locations=await client.query<{label:string;count:number;groups:number}>('SELECT location AS label,count(*)::int AS count,count(*) OVER()::int AS groups FROM assets GROUP BY location ORDER BY count DESC,location LIMIT 100');
  const sla=await client.query(`${selected} SELECT count(s.ticket_id)::int AS covered,
    count(*) FILTER(WHERE s.ticket_id IS NULL)::int AS uncovered,
    count(s.first_response_at)::int AS "responseCompleted",
    count(*) FILTER(WHERE s.first_response_at<=s.response_due_at)::int AS "responseMet",
    count(*) FILTER(WHERE COALESCE(s.first_response_at,clock_timestamp())>s.response_due_at)::int AS "responseBreached",
    count(*) FILTER(WHERE s.first_response_at IS NULL AND s.response_due_at>=clock_timestamp())::int AS "responsePending",
    count(s.resolved_at)::int AS "resolutionCompleted",
    count(*) FILTER(WHERE s.resolved_at<=s.resolution_due_at)::int AS "resolutionMet",
    count(*) FILTER(WHERE COALESCE(s.resolved_at,clock_timestamp())>s.resolution_due_at)::int AS "resolutionBreached",
    count(*) FILTER(WHERE s.resolved_at IS NULL AND s.resolution_due_at>=clock_timestamp())::int AS "resolutionPending"
    FROM cohort t LEFT JOIN ticket_sla s ON s.ticket_id=t.id`,params);
  return {generatedAt:clock.rows[0].at,scope:{filters,ticketBasis:'created_at',resolvedBasis:'distinct_ticket_with_closed_event_in_period',
    timingsBasis:'first_public_response_since_sla_enrollment_and_last_documented_closure_since_ticket_creation;calendar_minutes',timezone:'UTC'},totals:totals.rows[0],byPriority,byStatus,byCategory,
    workload:workload.rows.map(({groups:_groups,...row})=>row),workloadGroups:workload.rows[0]?.groups??0,workloadLimit:100,
    interventions:interventions.rows.map(({groups:_groups,...row})=>row),interventionGroups:interventions.rows[0]?.groups??0,interventionLimit:100,
    escalations:levels.rows[0],recurrence:{groups:recurrent.rows.map(({groups:_groups,...r})=>r),totalGroups:recurrent.rows[0]?.groups??0,limit:50,
      basis:'incidents_with_identical_normalized_title;not_confirmed_same_cause'},
    trends:trends.rows.map(({days:_days,...row})=>row).reverse(),trendDays:trends.rows[0]?.days??0,trendLimit:366,
    assets:{...assetTotals.rows[0],byState:assetStates.rows,locations:locations.rows.map(({groups:_groups,...r})=>r),locationGroups:locations.rows[0]?.groups??0,locationLimit:100,scope:'all_inventory;ticket_filters_do_not_apply'},
    sla:{available:true,...sla.rows[0],basis:'current_SLA_cycle;first_public_response;legacy_enrollment_starts_when_enabled'}};
}

export function registerReportRoutes(app:Express):void {
  async function data(req:Request){const filters=reportFilters.parse(req.query);return transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return collectReport(client,filters);
  });}
  app.get('/api/reports/summary',requireAuth,requireRole(...MANAGERS),route(async(req,res)=>{res.json({data:await data(req)});}));
  app.get('/api/reports/export',requireAuth,requireRole(...MANAGERS),route(async(req,res)=>{
    const report=await data(req);res.json({filename:'nexodesk-reportes.csv',mime:'text/csv;charset=utf-8',content:reportCsv(report)});
  }));
  app.get('/api/reports/export.csv',requireAuth,requireRole(...MANAGERS),route(async(req,res)=>{
    const report=await data(req);res.type('text/csv').setHeader('Content-Disposition','attachment; filename="nexodesk-reportes.csv"');res.send(reportCsv(report));
  }));
}
