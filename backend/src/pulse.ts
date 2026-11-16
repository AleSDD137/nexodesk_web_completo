/** Pulse V2.5: aggregates and bounded activity from the original SQL sources.
 * No local data, health scores, copied events or internal-note contents. */
import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, STAFF } from './auth.js';
import { transaction } from './ticket-audit.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>
  (req,res,next)=>{void fn(req,res).catch(next);};
const timestamp=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const validDay=(day:string)=>{
  const time=Date.parse(`${day}T00:00:00Z`);
  return !day.startsWith('0000')&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day;
};
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDay,'Fecha inválida; usar YYYY-MM-DD');
const range=z.object({from:day.optional(),to:day.optional()}).strict();
function checkRange(value:{from?:string,to?:string}):void {
  if(value.from&&value.to&&value.from>value.to)throw new z.ZodError([
    {code:'custom',path:['to'],message:'La fecha final debe ser igual o posterior a la inicial'}
  ]);
}
// Parameters always use explicit UTC boundaries, independently of DB timezone.
const ticketRange=`($1::date IS NULL OR t.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC'))
  AND ($2::date IS NULL OR t.created_at < (($2::date+1)::timestamp AT TIME ZONE 'UTC'))`;
const workloadCondition=`assignee<>'Sin asignar' AND btrim(assignee)<>''`;

const cursorStamp=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine(value=>validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&
    Number(value.slice(11,13))<24&&Number(value.slice(14,16))<60&&Number(value.slice(17,19))<60);
const cursorSchema=z.object({v:z.literal(1),asOf:cursorStamp,at:cursorStamp,
  rank:z.union([z.literal(0),z.literal(1)]),
  id:z.string().regex(/^[1-9]\d{0,18}$/).refine(value=>/^[1-9]\d{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n),
  from:day.nullable(),to:day.nullable()}).strict().refine(value=>value.at<=value.asOf);
type Cursor=z.infer<typeof cursorSchema>;
function readCursor(raw:string,from:string|null,to:string|null):Cursor {
  let value:unknown;
  try {
    if(!/^[A-Za-z0-9_-]+$/.test(raw))throw Error('encoding');
    value=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  }catch{
    throw new z.ZodError([{code:'custom',path:['cursor'],message:'Cursor de actividad inválido'}]);
  }
  const cursor=cursorSchema.parse(value);
  if(cursor.from!==from||cursor.to!==to)throw new z.ZodError([
    {code:'custom',path:['cursor'],message:'El cursor no corresponde al filtro de fechas'}
  ]);
  return cursor;
}

export function registerPulseRoutes(app:Express):void {
  app.get('/api/pulse/summary',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const input=range.parse(req.query);checkRange(input);
    const from=input.from??null,to=input.to??null;
    const data=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const clock=await client.query(`SELECT ${timestamp('clock_timestamp()')} AS at`);
      const totals=await client.query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE t.status<>'Cerrado')::int AS open,
        count(*) FILTER(WHERE t.status='En atención')::int AS "inProgress",
        count(*) FILTER(WHERE t.status='Validación')::int AS validation,
        count(*) FILTER(WHERE t.status='Cerrado')::int AS closed,
        count(*) FILTER(WHERE t.status<>'Cerrado' AND (t.assignee='Sin asignar' OR btrim(t.assignee)=''))::int AS unassigned
        FROM tickets t WHERE ${ticketRange}`,[from,to]);
      const statuses=await client.query(`WITH counts AS (
        SELECT t.status,count(*)::int AS count FROM tickets t WHERE ${ticketRange} GROUP BY t.status)
        SELECT s.status,COALESCE(c.count,0)::int AS count FROM
          (VALUES('Registrado',1),('En revisión',2),('En atención',3),('Validación',4),('Cerrado',5)) AS s(status,position)
        LEFT JOIN counts c ON c.status=s.status ORDER BY s.position`,[from,to]);
      const priorities=await client.query(`WITH counts AS (
        SELECT t.priority,count(*)::int AS count FROM tickets t WHERE ${ticketRange} GROUP BY t.priority)
        SELECT p.priority,COALESCE(c.count,0)::int AS count FROM
          (VALUES('Crítica',1),('Alta',2),('Media',3),('Baja',4)) AS p(priority,position)
        LEFT JOIN counts c ON c.priority=p.priority ORDER BY p.position`,[from,to]);
      const workload=await client.query(`SELECT t.assignee,count(*)::int AS total,
        count(*) FILTER(WHERE t.status<>'Cerrado')::int AS open,
        count(*) FILTER(WHERE t.status='Cerrado')::int AS closed,
        count(*) OVER()::int AS groups FROM tickets t
        WHERE ${ticketRange} AND ${workloadCondition}
        GROUP BY t.assignee ORDER BY open DESC,total DESC,t.assignee ASC LIMIT 50`,[from,to]);
      const levels=await client.query(`SELECT count(*) FILTER(WHERE c.level=2)::int AS l2,
        count(*) FILTER(WHERE c.level=3)::int AS l3 FROM triage_cases c
        JOIN tickets t ON t.id=c.ticket_id WHERE ${ticketRange}`,[from,to]);
      return {generatedAt:clock.rows[0].at,scope:{from,to,ticketBasis:'created_at',unassignedBasis:'open_tickets'},
        totals:totals.rows[0],byStatus:statuses.rows,byPriority:priorities.rows,
        workload:workload.rows.map(({groups:_groups,...entry})=>entry),
        workloadLimit:50,totalWorkloadGroups:workload.rows[0]?.groups??0,escalated:levels.rows[0]};
    });
    res.json({data});
  }));

  app.get('/api/pulse/activity',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const input=range.extend({limit:z.coerce.number().int().min(1).max(100).default(20),
      cursor:z.string().min(1).max(2048).optional()}).parse(req.query);checkRange(input);
    const from=input.from??null,to=input.to??null;
    const cursor=input.cursor?readCursor(input.cursor,from,to):null;
    const response=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const clock=await client.query(`SELECT ${timestamp('clock_timestamp()')} AS at`);
      const asOf=cursor?.asOf??clock.rows[0].at;
      // Original audit/Triage rows are read once. Private notes and their text,
      // diagnosis bodies and pending instructions are deliberately not selected.
      const {rows}=await client.query(`WITH ticket_page AS (
        SELECT e.id,e.ticket_id,e.kind,e.actor_name,e.actor_id,e.occurred_at AS at,0 AS rank,
          e.changes,NULL::smallint AS from_level,NULL::smallint AS to_level
        FROM ticket_events e
        WHERE e.occurred_at<=$3::timestamptz
          AND ($1::date IS NULL OR e.occurred_at>=($1::date::timestamp AT TIME ZONE 'UTC'))
          AND ($2::date IS NULL OR e.occurred_at<(($2::date+1)::timestamp AT TIME ZONE 'UTC'))
          AND ($4::timestamptz IS NULL OR (e.occurred_at,0,e.id)<($4::timestamptz,$5::int,$6::bigint))
        ORDER BY e.occurred_at DESC,e.id DESC LIMIT $7::int
      ), triage_page AS (
        SELECT e.id,e.ticket_id,CASE WHEN e.kind='Transferencia' THEN 'transfer' ELSE 'diagnosis' END,
          e.actor_name,e.created_by,e.created_at AS at,1 AS rank,e.changes,e.from_level,e.to_level
        FROM triage_events e
        WHERE e.created_at<=$3::timestamptz
          AND ($1::date IS NULL OR e.created_at>=($1::date::timestamp AT TIME ZONE 'UTC'))
          AND ($2::date IS NULL OR e.created_at<(($2::date+1)::timestamp AT TIME ZONE 'UTC'))
          AND ($4::timestamptz IS NULL OR (e.created_at,1,e.id)<($4::timestamptz,$5::int,$6::bigint))
        ORDER BY e.created_at DESC,e.id DESC LIMIT $7::int
      ), sources AS (
        SELECT * FROM ticket_page UNION ALL SELECT * FROM triage_page
      ), page AS (
        SELECT * FROM sources
        ORDER BY at DESC,rank DESC,id DESC LIMIT $7::int
      ) SELECT p.id::text AS "sourceId",p.ticket_id AS "ticketId",t.title,p.kind,
        COALESCE(p.actor_name,u.name) AS "actorName",
        p.rank,${timestamp('p.at')} AS "occurredAt",p.from_level AS "fromLevel",p.to_level AS "toLevel",
        COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p.changes)
          WHERE key IN ('status','priority','assignee')),'{}'::jsonb) AS changes
      FROM page p JOIN tickets t ON t.id=p.ticket_id LEFT JOIN users u ON u.id=p.actor_id
      ORDER BY p.at DESC,p.rank DESC,p.id DESC`,
      [from,to,asOf,cursor?.at??null,cursor?.rank??null,cursor?.id??null,input.limit+1]);
      const hasMore=rows.length>input.limit,visible=rows.slice(0,input.limit),last=visible.at(-1);
      const data=visible.map(({rank,sourceId,...entry})=>({
        ...entry,id:`${rank===0?'event':'triage'}:${sourceId}`,source:rank===0?'ticket':'triage'
      }));
      const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({v:1,asOf,at:last.occurredAt,
        rank:last.rank,id:last.sourceId,from,to} satisfies Cursor)).toString('base64url'):null;
      return {data,nextCursor,hasMore,generatedAt:clock.rows[0].at};
    });
    res.json(response);
  }));
}
