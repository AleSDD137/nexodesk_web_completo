/** Read-only paginated search. User discovery remains manager-only. */
import type {Express,RequestHandler} from 'express';
import {z} from 'zod';
import {requireAuth} from './auth.js';
import {transaction} from './ticket-audit.js';
export function registerSearchRoutes(app:Express):void {
 const handler:RequestHandler=(req,res,next)=>{void(async()=>{
  const q=z.object({q:z.string().trim().min(1).max(120),type:z.enum(['tickets','users']).default('tickets'),limit:z.coerce.number().int().min(1).max(50).default(10),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict().parse(req.query);
  const self=req.currentUser!,requester=self.role==='Solicitante';
  if(q.type==='users'&&!['Administrador','Coordinador'].includes(self.role)){res.status(403).json({error:'Búsqueda de usuarios reservada a administración y coordinación'});return;}
  const result=await transaction(async client=>{
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
   const users=q.type==='users',table=users?'users':'tickets';
   const filter=users?'(name ILIKE $1 OR email ILIKE $1 OR id::text=$2)':'(title ILIKE $1 OR id::text=$2)'+(requester?' AND requester_email=$3':'');
   const values:unknown[]=[`%${q.q}%`,q.q.replace(/^#/,''),...(requester&&!users?[self.email]:[])];
   const total=await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${filter}`,values);
   const rows=await client.query(`SELECT ${users?'id,name,email,role':'id,title,status'} FROM ${table} WHERE ${filter} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,q.limit,q.offset]);
   return {data:rows.rows,total:total.rows[0].n,limit:q.limit,offset:q.offset};
  });res.json(result);
 })().catch(next);};
 app.get('/api/search',requireAuth,handler);
}
