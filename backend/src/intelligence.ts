import type { Express,Request,Response,RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth,requireRole,STAFF } from './auth.js';
import { pool } from './db.js';
import { transaction } from './ticket-audit.js';
import { externalContext,localAdvice,openAIProvider,providerAdvice,technicalTokens,type DiagnosticInput } from './intelligence-engine.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const id=(value:string)=>z.coerce.number().int().positive().safe().parse(value);
const configInt=(name:string,fallback:number,max:number)=>{
 const value=Number(process.env[name]??fallback);return Number.isSafeInteger(value)&&value>=0?Math.min(value,max):0;
};
function config(){
 const key=process.env.OPENAI_API_KEY?.trim()||'',enabled=process.env.INTELLIGENCE_EXTERNAL_ENABLED==='true';
 const model=process.env.INTELLIGENCE_MODEL||'gpt-6-luna';
 return {key,enabled,model:/^[a-zA-Z0-9._-]{1,100}$/.test(model)?model:'gpt-6-luna',
  tokens:configInt('INTELLIGENCE_DAILY_TOKEN_BUDGET',20000,1000000),
  requests:configInt('INTELLIGENCE_DAILY_REQUEST_LIMIT',20,1000),
  hourly:configInt('INTELLIGENCE_USER_HOURLY_LIMIT',10,100)};
}
const suggestionFields=`id,ticket_id AS "ticketId",provider,payload,decision,decided_by AS "decidedBy",decided_at AS "decidedAt",created_at AS "createdAt"`;
export function registerIntelligenceRoutes(app:Express):void {
 const staff=[requireAuth,requireRole(...STAFF)];
 app.get('/api/intelligence/status',...staff,route(async(_req,res)=>{
  const c=config();res.json({data:{provider:c.enabled&&c.key?'openai':'local',model:c.enabled&&c.key?c.model:null,
   externalEnabled:c.enabled&&!!c.key,dailyTokenBudget:c.tokens,dailyRequestLimit:c.requests,userHourlyLimit:c.hourly,
   notice:'Orientaciones para revisión humana. No modifica tickets ni ejecuta acciones.'}});
 }));
 app.get('/api/tickets/:id/intelligence',...staff,route(async(req,res)=>{
  const ticketId=id(req.params.id);
  if(!(await pool.query('SELECT 1 FROM tickets WHERE id=$1',[ticketId])).rowCount){res.status(404).json({error:'Ticket no encontrado'});return;}
  const {rows}=await pool.query(`SELECT ${suggestionFields} FROM intelligence_suggestions WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10`,[ticketId]);
  res.json({data:rows,limit:10});
 }));
 app.post('/api/tickets/:id/intelligence',...staff,route(async(req,res)=>{
  z.object({}).strict().parse(req.body);const ticketId=id(req.params.id),c=config();
  const ticket=await pool.query(`SELECT t.title,left(t.description,6000) AS description,COALESCE(c.category,'Sin clasificar') AS category
   FROM tickets t LEFT JOIN triage_cases c ON c.ticket_id=t.id WHERE t.id=$1`,[ticketId]);
  if(!ticket.rowCount){res.status(404).json({error:'Ticket no encontrado'});return;}
  const tokens=technicalTokens(ticket.rows[0].title+' '+ticket.rows[0].description+' '+ticket.rows[0].category);
  const references=tokens.length?await pool.query(`SELECT t.id,t.title,t.status,left(c.diagnosis,2000) AS diagnosis
   FROM tickets t LEFT JOIN triage_cases c ON c.ticket_id=t.id
   WHERE t.id<>$1 AND to_tsvector('simple',t.title||' '||t.description) @@ to_tsquery('simple',$2)
   ORDER BY ts_rank(to_tsvector('simple',t.title||' '||t.description),to_tsquery('simple',$2)) DESC,t.id DESC LIMIT 5`,[ticketId,tokens.join(' | ')]):{rows:[]};
  const input:DiagnosticInput={...ticket.rows[0],antecedents:references.rows.map(r=>({id:Number(r.id),title:r.title,status:r.status,diagnosis:r.diagnosis??''}))};
  // The UTF-8 byte length is a conservative input-token ceiling for this ASCII
  // allowlisted context. Reserve fixed instructions/schema overhead as well.
  const reservation=Buffer.byteLength(externalContext(input),'utf8')+4000+600;
  const run=await transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(260026)');
   const recent=await client.query(`SELECT count(*)::int AS n FROM intelligence_runs WHERE requested_by=$1 AND created_at>clock_timestamp()-interval '1 hour'`,[req.currentUser!.id]);
   if(recent.rows[0].n>=c.hourly)return null;
   const budget=await client.query(`SELECT COALESCE(sum(reserved_tokens),0)::bigint AS tokens,count(*)::int AS requests FROM intelligence_runs
    WHERE provider='openai' AND created_at>=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`);
   const external=c.enabled&&!!c.key&&Number(budget.rows[0].tokens)+reservation<=c.tokens&&budget.rows[0].requests<c.requests;
   const reason=c.enabled&&c.key&&!external?'daily_budget':null;
   const {rows}=await client.query(`INSERT INTO intelligence_runs(ticket_id,requested_by,provider,model,reserved_tokens,error_code)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[ticketId,req.currentUser!.id,external?'openai':'local',external?c.model:null,external?reservation:0,reason]);
   return {id:rows[0].id,external,reason};
  });
  if(!run){res.status(429).json({error:'Límite horario de Intelligence alcanzado. Volvé a intentar más tarde.'});return;}
  let advice=localAdvice(input),provider='local',reason=run.reason;
  if(run.external){
   try {advice=await providerAdvice(input,openAIProvider(c.key),c.model);provider='openai';}
   catch {reason='provider_unavailable';} // Never store/log provider body, key, headers or unsafe exception.
  }
  const payload={...advice,antecedents:input.antecedents,notice:'Sugerencia no verificada. Revisar antes de actuar.',fallbackReason:reason};
  const result=await transaction(async client=>{
   await client.query('UPDATE intelligence_runs SET outcome=$1,error_code=$2 WHERE id=$3',[reason?'fallback':'complete',reason,run.id]);
   const {rows}=await client.query(`INSERT INTO intelligence_suggestions(ticket_id,run_id,provider,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING ${suggestionFields}`,[ticketId,run.id,provider,JSON.stringify(payload)]);
   return rows[0];
  });
  res.status(201).json({data:result});
 }));
 app.put('/api/intelligence/suggestions/:id/decision',...staff,route(async(req,res)=>{
  const suggestionId=id(req.params.id),form=z.object({decision:z.enum(['accepted','discarded'])}).strict().parse(req.body);
  const {rows}=await pool.query(`UPDATE intelligence_suggestions SET decision=$1,decided_by=$2,decided_at=clock_timestamp()
   WHERE id=$3 AND decision='pending' RETURNING ${suggestionFields}`,[form.decision,req.currentUser!.id,suggestionId]);
  if(!rows.length){res.status(409).json({error:'Sugerencia inexistente o ya revisada. Actualizá el historial.'});return;}
  res.json({data:rows[0]});
 }));
}
