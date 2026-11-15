import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireRole, STAFF } from './auth.js';
import { transaction } from './ticket-audit.js';

type Actor={id:unknown,name:string|null};
type Activity={id:string,source:string,kind:string,ticketId:unknown,actor:Actor,occurredAt:string|null,
  changes:Record<string,unknown>,text:string,context?:Record<string,unknown>,recordedDate?:string};
const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const getId=(raw:string)=>z.coerce.number().int().positive().safe().parse(raw);
const noteInput=z.object({content:z.string().trim().min(1).max(5000)}).strict();
const timestamp=(column:string)=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Localized old dates (e.g. 02/03/2026) are ambiguous and remain undated.
// Normalize only documented ISO timestamps, preserving microseconds for ties.
export function commentTimestamp(raw:unknown):string|null {
  if(typeof raw!=='string')return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if(!match)return null;
  const [,y,m,d,h,minute,s,fraction='']=match;
  const year=Number(y),month=Number(m),day=Number(d);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1]||Number(h)>23||Number(minute)>59||Number(s)>59)return null;
  const value=Date.parse(raw);
  if(!Number.isFinite(value))return null;
  return new Date(value).toISOString().replace(/\.(\d{3})Z$/,'.$1'+fraction.padEnd(6,'0').slice(3)+'Z');
}

const ranks:Record<string,number>={ticket:0,triage:1,comment:2,note:3};
export function sortActivity(items:Activity[]):Activity[] {
  return items.sort((a,b)=>{
    if(a.occurredAt!==b.occurredAt){
      if(a.occurredAt===null)return 1;if(b.occurredAt===null)return -1;
      return a.occurredAt<b.occurredAt?-1:1;
    }
    const rank=ranks[a.source]-ranks[b.source];if(rank)return rank;
    const ai=BigInt(a.id.slice(a.id.indexOf(':')+1)),bi=BigInt(b.id.slice(b.id.indexOf(':')+1));
    return ai<bi?-1:ai>bi?1:0;
  });
}

async function activity(ticketId:number):Promise<Activity[]|null> {
  return transaction(async client=>{
    // All sources belong to one consistent snapshot, including JSON comments.
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const ticket=await client.query('SELECT comments FROM tickets WHERE id=$1',[ticketId]);
    if(!ticket.rowCount)return null;
    const events=await client.query(`SELECT id,kind,actor_id,actor_name,changes,context,
      ${timestamp('occurred_at')} AS at FROM ticket_events WHERE ticket_id=$1`,[ticketId]);
    const triage=await client.query(`SELECT e.id,e.kind,e.created_by,COALESCE(e.actor_name,u.name) AS actor_name,
      e.changes,e.from_level,e.to_level,e.note,e.pending,${timestamp('e.created_at')} AS at
      FROM triage_events e LEFT JOIN users u ON u.id=e.created_by WHERE e.ticket_id=$1`,[ticketId]);
    const notes=await client.query(`SELECT id,author_id,author_name,content,
      ${timestamp('created_at')} AS at FROM ticket_internal_notes WHERE ticket_id=$1`,[ticketId]);
    const items:Activity[]=events.rows.map(e=>({id:`event:${e.id}`,source:'ticket',kind:e.kind,ticketId,
      actor:{id:e.actor_id,name:e.actor_name},occurredAt:e.at,changes:e.changes,context:e.context,
      text:({created:'Ticket creado',updated:'Información del ticket actualizada',closed:'Ticket cerrado',reopened:'Ticket reabierto'} as Record<string,string>)[e.kind]}));
    for(const e of triage.rows)items.push({id:`triage:${e.id}`,source:'triage',kind:e.kind==='Transferencia'?'transfer':'diagnosis',ticketId,
      actor:{id:e.created_by,name:e.actor_name},occurredAt:e.at,changes:e.changes,
      text:e.note+(e.pending?`\nPróximos pasos: ${e.pending}`:''),context:{fromLevel:e.from_level,toLevel:e.to_level}});
    for(const n of notes.rows)items.push({id:`note:${n.id}`,source:'note',kind:'internal_note',ticketId,
      actor:{id:n.author_id,name:n.author_name},occurredAt:n.at,changes:{},text:n.content});
    const comments=Array.isArray(ticket.rows[0].comments)?ticket.rows[0].comments:[];
    comments.forEach((c:unknown,index:number)=>{
      if(!c||typeof c!=='object'||!('text'in c)||typeof c.text!=='string')return;
      const entry=c as Record<string,unknown>;
      if(entry.internal===true||(entry.visibility!==undefined&&entry.visibility!=='public'))return;
      items.push({id:`comment:${index}`,source:'comment',kind:'public_comment',ticketId,
        actor:{id:typeof entry.authorId==='number'&&Number.isSafeInteger(entry.authorId)&&entry.authorId>0?entry.authorId:null,
          name:typeof entry.author==='string'?entry.author:null},occurredAt:commentTimestamp(entry.date),
        recordedDate:typeof entry.date==='string'?entry.date:'',changes:{},text:c.text});
    });
    return sortActivity(items);
  });
}

export function registerActivityRoutes(app:Express):void {
  app.get('/api/tickets/:id/activity',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const items=await activity(getId(req.params.id));
    if(items===null){res.status(404).json({error:'Ticket no encontrado'});return;}
    res.json({data:items});
  }));
  app.get('/api/tickets/:id/notes',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=getId(req.params.id);
    if(!(await pool.query('SELECT 1 FROM tickets WHERE id=$1',[id])).rowCount){res.status(404).json({error:'Ticket no encontrado'});return;}
    const {rows}=await pool.query(`SELECT id,ticket_id AS "ticketId",author_id AS "authorId",author_name AS "authorName",content,
      ${timestamp('created_at')} AS "createdAt" FROM ticket_internal_notes WHERE ticket_id=$1 ORDER BY created_at,id`,[id]);
    res.json({data:rows});
  }));
  app.post('/api/tickets/:id/notes',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=getId(req.params.id),form=noteInput.parse(req.body),user=req.currentUser!;
    const note=await transaction(async client=>{
      if(!(await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE',[id])).rowCount)return null;
      const {rows}=await client.query(`INSERT INTO ticket_internal_notes(ticket_id,author_id,author_name,content)
        VALUES($1,$2,$3,$4) RETURNING id,ticket_id AS "ticketId",author_id AS "authorId",author_name AS "authorName",content,
        ${timestamp('created_at')} AS "createdAt"`,[id,user.id,user.name,form.content]);
      return rows[0];
    });
    if(!note){res.status(404).json({error:'Ticket no encontrado'});return;}
    res.status(201).json({data:note});
  }));
}
