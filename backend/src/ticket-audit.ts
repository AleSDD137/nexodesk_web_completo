import type { PoolClient } from 'pg';
import type { AuthUser } from './auth.js';
import { pool } from './db.js';

export type Changes = Record<string,{old:unknown,new:unknown}>;
const ticketKeys=['title','description','type','priority','status','requester','assignee'] as const;

export function changedValues(before:Record<string,unknown>,after:Record<string,unknown>,keys:readonly string[]):Changes {
  const changes:Changes={};
  for(const key of keys)if(before[key]!==after[key])changes[key]={old:before[key]??null,new:after[key]??null};
  return changes;
}

export async function transaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(err){await client.query('ROLLBACK');throw err;}
  finally{client.release();}
}

export async function recordCreated(client:PoolClient,ticket:Record<string,unknown>,actor:AuthUser,operation:string):Promise<void> {
  const changes=changedValues({},ticket,ticketKeys);
  await client.query(`INSERT INTO ticket_events(ticket_id,kind,actor_id,actor_name,changes,context)
    VALUES($1,'created',$2,$3,$4::jsonb,$5::jsonb)`,
    [ticket.id,actor.id,actor.name,JSON.stringify(changes),JSON.stringify({operation})]);
}

export async function recordChanges(client:PoolClient,ticketId:unknown,before:Record<string,unknown>,after:Record<string,unknown>,actor:AuthUser,operation:string):Promise<Changes> {
  const changes=changedValues(before,after,ticketKeys);
  if(!Object.keys(changes).length)return changes;
  const kind=changes.status?.new==='Cerrado'?'closed':changes.status?.old==='Cerrado'?'reopened':'updated';
  await client.query(`INSERT INTO ticket_events(ticket_id,kind,actor_id,actor_name,changes,context)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [ticketId,kind,actor.id,actor.name,JSON.stringify(changes),JSON.stringify({operation})]);
  return changes;
}
