/** SLA policy snapshots, bounded checks and idempotent alert-only escalation. */
import type { Express, Request, Response, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth,requireRole,STAFF,MANAGERS } from './auth.js';
import { transaction } from './ticket-audit.js';
import { addBusinessMinutes,validTimezone } from './sla-clock.js';
const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const priority=z.enum(['Baja','Media','Alta','Crítica']);
const identifier=z.coerce.number().int().positive().safe();
const policySchema=z.object({
 responseMinutes:z.number().int().min(1).max(10080),resolutionMinutes:z.number().int().min(1).max(10080),
 timezone:z.string().max(80).refine(validTimezone,'Zona horaria IANA inválida'),
 weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length,'Días duplicados'),
 startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),
 warningMinutes:z.number().int().min(0).max(1440),escalationEnabled:z.boolean(),escalationLevel:z.union([z.literal(2),z.literal(3)]),enabled:z.boolean()
}).strict().superRefine((p,ctx)=>{
 if(p.endMinute-p.startMinute<60)ctx.addIssue({code:'custom',path:['endMinute'],message:'La ventana laboral debe durar al menos 60 minutos'});
 if(p.resolutionMinutes<p.responseMinutes)ctx.addIssue({code:'custom',path:['resolutionMinutes'],message:'Resolución debe ser posterior a primera respuesta'});
 if(p.resolutionMinutes>(p.endMinute-p.startMinute)*p.weekdays.length*4)ctx.addIssue({code:'custom',path:['resolutionMinutes'],message:'El objetivo debe caber en cuatro semanas laborales configuradas'});
});
export type SlaPolicy=z.infer<typeof policySchema>;
const fields=`priority,response_minutes AS "responseMinutes",resolution_minutes AS "resolutionMinutes",timezone,weekdays,
 start_minute AS "startMinute",end_minute AS "endMinute",warning_minutes AS "warningMinutes",escalation_enabled AS "escalationEnabled",
 escalation_level AS "escalationLevel",enabled,updated_at AS "updatedAt"`;
function snapshot(row:Record<string,unknown>):SlaPolicy {
 const {priority:_priority,updatedAt:_updatedAt,...data}=row;return policySchema.parse(data);
}
export async function enrollTicketSla(client:PoolClient,ticketId:number|string,level:string,createdAt:Date|string):Promise<boolean> {
 if((await client.query('SELECT 1 FROM ticket_sla WHERE ticket_id=$1',[ticketId])).rowCount)return false;
 const result=await client.query(`SELECT ${fields} FROM sla_policies WHERE priority=$1 AND enabled`,[level]);
 if(!result.rowCount)return false;
 const policy=snapshot(result.rows[0]),start=new Date(createdAt);
 const response=addBusinessMinutes(start,policy.responseMinutes,policy),resolution=addBusinessMinutes(start,policy.resolutionMinutes,policy);
 const inserted=await client.query(`INSERT INTO ticket_sla(ticket_id,policy,started_at,response_due_at,resolution_due_at)
  VALUES($1,$2::jsonb,$3,$4,$5) ON CONFLICT(ticket_id) DO NOTHING`,[ticketId,JSON.stringify({...policy,priority:level,policyUpdatedAt:result.rows[0].updatedAt}),start,response,resolution]);
 return (inserted.rowCount??0)>0;
}
export async function recordSlaResponse(client:PoolClient,ticketId:number|string,_actorId:number):Promise<void> {
 await client.query(`UPDATE ticket_sla SET first_response_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE ticket_id=$1 AND first_response_at IS NULL`,[ticketId]);
}
export async function recordSlaStatus(client:PoolClient,ticketId:number|string,status:string):Promise<void> {
 if(status==='Cerrado')await client.query(`UPDATE ticket_sla SET resolved_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE ticket_id=$1 AND resolved_at IS NULL`,[ticketId]);
 else await client.query(`UPDATE ticket_sla SET resolved_at=NULL,cycle=cycle+1,updated_at=clock_timestamp()
  WHERE ticket_id=$1 AND resolved_at IS NOT NULL`,[ticketId]);
}
export async function runSlaChecks(after=0,limit=100):Promise<{processed:number;enrolled:number;alertsCreated:number;nextAfter:number|null}> {
 return transaction(async client=>{
  const tickets=await client.query(`SELECT t.id,t.priority FROM tickets t WHERE t.id>$1 AND t.status<>'Cerrado'
   ORDER BY t.id LIMIT $2 FOR UPDATE OF t`,[after,limit]);
  let enrolled=0,alertsCreated=0;
  const clock=(await client.query('SELECT clock_timestamp() AS at')).rows[0].at as Date;
  for(const ticket of tickets.rows){
   if(!(await client.query('SELECT 1 FROM ticket_sla WHERE ticket_id=$1',[ticket.id])).rowCount){
    if(await enrollTicketSla(client,ticket.id,ticket.priority,clock))enrolled++;
   }
   const data=await client.query(`SELECT policy,response_due_at,resolution_due_at,first_response_at,resolved_at,cycle FROM ticket_sla WHERE ticket_id=$1 FOR UPDATE`,[ticket.id]);
   if(!data.rowCount)continue;
   const s=data.rows[0],p=s.policy as SlaPolicy,kinds:Array<{kind:string;level:number|null}>=[];
   for(const [type,due,finished] of [['response',s.response_due_at,s.first_response_at],['resolution',s.resolution_due_at,s.resolved_at]] as const){
    if(finished)continue;
    const left=new Date(due).getTime()-clock.getTime();
    if(left<=0)kinds.push({kind:`${type}_breach`,level:null});
    else if(left<=p.warningMinutes*60000)kinds.push({kind:`${type}_warning`,level:null});
   }
   if(p.escalationEnabled&&kinds.some(k=>k.kind.endsWith('_breach')))kinds.push({kind:'escalation',level:p.escalationLevel});
   for(const item of kinds){const inserted=await client.query(`INSERT INTO sla_alerts(ticket_id,cycle,kind,target_level)
    VALUES($1,$2,$3,$4) ON CONFLICT(ticket_id,cycle,kind) DO NOTHING RETURNING id`,[ticket.id,s.cycle,item.kind,item.level]);alertsCreated+=inserted.rowCount??0;}
  }
  const last=tickets.rows.at(-1)?.id;
  const hasMore=last&&(await client.query(`SELECT 1 FROM tickets WHERE id>$1 AND status<>'Cerrado' LIMIT 1`,[last])).rowCount;
  return {processed:tickets.rows.length,enrolled,alertsCreated,nextAfter:hasMore?Number(last):null};
 });
}
export function startSlaWorker():NodeJS.Timeout|null {
 const seconds=Number(process.env.SLA_CHECK_INTERVAL_SECONDS??0);if(seconds===0)return null;
 if(!Number.isInteger(seconds)||seconds<60||seconds>86400)throw Error('SLA_CHECK_INTERVAL_SECONDS debe ser 0 o 60..86400');
 let busy=false,after=0;
 const timer=setInterval(()=>{if(busy)return;busy=true;void runSlaChecks(after).then(r=>{after=r.nextAfter??0;})
  .catch(()=>console.error('SLA: comprobación no completada')).finally(()=>{busy=false;});},seconds*1000);
 timer.unref();return timer;
}
export function registerSlaRoutes(app:Express):void {
 const staff=[requireAuth,requireRole(...STAFF)];
 app.get('/api/sla/policies',...staff,route(async(_req,res)=>{res.json({data:(await pool.query(`SELECT ${fields} FROM sla_policies ORDER BY response_minutes`)).rows});}));
 app.put('/api/sla/policies/:priority',requireAuth,requireRole(...MANAGERS),route(async(req,res)=>{
  const level=priority.parse(req.params.priority),p=policySchema.parse(req.body);
  const result=await pool.query(`UPDATE sla_policies SET response_minutes=$1,resolution_minutes=$2,timezone=$3,weekdays=$4,
   start_minute=$5,end_minute=$6,warning_minutes=$7,escalation_enabled=$8,escalation_level=$9,enabled=$10,
   updated_by=$11,updated_at=clock_timestamp() WHERE priority=$12 RETURNING ${fields}`,
   [p.responseMinutes,p.resolutionMinutes,p.timezone,p.weekdays,p.startMinute,p.endMinute,p.warningMinutes,p.escalationEnabled,p.escalationLevel,p.enabled,req.currentUser!.id,level]);
  res.json({data:result.rows[0]});
 }));
 app.get('/api/sla/tickets',...staff,route(async(req,res)=>{
  const q=z.object({priority:priority.optional(),status:z.enum(['pending','overdue','met','breached']).optional(),limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict().parse(req.query);
  const filter=`($1::text IS NULL OR t.priority=$1) AND ($2::text IS NULL OR
   CASE WHEN (s.first_response_at IS NULL AND s.response_due_at<clock_timestamp()) OR (s.resolved_at IS NULL AND s.resolution_due_at<clock_timestamp()) THEN 'overdue'
   WHEN s.resolved_at IS NOT NULL AND s.resolved_at<=s.resolution_due_at AND s.first_response_at IS NOT NULL AND s.first_response_at<=s.response_due_at THEN 'met' WHEN s.first_response_at>s.response_due_at OR s.resolved_at>s.resolution_due_at THEN 'breached' ELSE 'pending' END=$2)`;
  const result=await transaction(async client=>{
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   const count=await client.query(`SELECT count(*)::int AS total FROM ticket_sla s JOIN tickets t ON t.id=s.ticket_id WHERE ${filter}`,[q.priority??null,q.status??null]);
   const data=await client.query(`SELECT t.id,t.title,t.priority,t.status,s.started_at AS "startedAt",s.response_due_at AS "responseDueAt",
    s.resolution_due_at AS "resolutionDueAt",s.first_response_at AS "firstResponseAt",s.resolved_at AS "resolvedAt",s.cycle,s.policy,
    CASE WHEN s.first_response_at IS NULL THEN CASE WHEN s.response_due_at<clock_timestamp() THEN 'overdue' ELSE 'pending' END
    WHEN s.first_response_at<=s.response_due_at THEN 'met' ELSE 'breached' END AS "responseState",
    CASE WHEN s.resolved_at IS NULL THEN CASE WHEN s.resolution_due_at<clock_timestamp() THEN 'overdue' ELSE 'pending' END
    WHEN s.resolved_at<=s.resolution_due_at THEN 'met' ELSE 'breached' END AS "resolutionState"
    FROM ticket_sla s JOIN tickets t ON t.id=s.ticket_id WHERE ${filter} ORDER BY s.resolution_due_at,t.id LIMIT $3 OFFSET $4`,
    [q.priority??null,q.status??null,q.limit,q.offset]);
   return {data:data.rows,total:count.rows[0].total,limit:q.limit,offset:q.offset,scope:'Solo tickets con política SLA registrada; no se infiere historia anterior.'};
  });res.json(result);
 }));
 app.get('/api/sla/alerts',...staff,route(async(req,res)=>{
  const q=z.object({limit:z.coerce.number().int().min(1).max(100).default(30),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict().parse(req.query);
  const result=await pool.query(`SELECT a.id,a.ticket_id AS "ticketId",t.title,a.cycle,a.kind,a.target_level AS "targetLevel",
   a.created_at AS "createdAt",a.acknowledged_at AS "acknowledgedAt",u.name AS "acknowledgedBy"
   FROM sla_alerts a JOIN tickets t ON t.id=a.ticket_id LEFT JOIN users u ON u.id=a.acknowledged_by
   ORDER BY a.created_at DESC,a.id DESC LIMIT $1 OFFSET $2`,[q.limit,q.offset]);
  res.json({data:result.rows,limit:q.limit,offset:q.offset});
 }));
 app.post('/api/sla/check',...staff,route(async(req,res)=>{
  const q=z.object({after:z.number().int().min(0).safe().default(0),limit:z.number().int().min(1).max(100).default(100)}).strict().parse(req.body);
  res.json({data:await runSlaChecks(q.after,q.limit)});
 }));
 app.post('/api/sla/alerts/:id/acknowledge',...staff,route(async(req,res)=>{
  const id=identifier.parse(req.params.id);z.object({}).strict().parse(req.body);
  const data=await pool.query(`UPDATE sla_alerts SET acknowledged_by=COALESCE(acknowledged_by,$1),
   acknowledged_at=COALESCE(acknowledged_at,clock_timestamp()) WHERE id=$2 RETURNING id`,[req.currentUser!.id,id]);
  if(!data.rowCount){res.status(404).json({error:'Alerta no encontrada'});return;}res.json({data:data.rows[0]});
 }));
}
