import type { PoolClient } from 'pg';
import type { AuthUser } from './auth.js';
import { changedValues } from './ticket-audit.js';

const fields=['kind','brand','serial','owner','location','state','ticketId','ownerUserId'] as const;
export async function recordAssetChange(client:PoolClient,before:Record<string,unknown>,after:Record<string,unknown>,actor:AuthUser,kind:'created'|'updated'|'imported'|'owner_linked'):Promise<void>{
  const changes=changedValues(before,after,fields);
  if(!Object.keys(changes).length)return;
  await client.query(`INSERT INTO asset_events(asset_id,actor_id,actor_name,kind,changes)
    VALUES($1,$2,$3,$4,$5::jsonb)`,[after.id,actor.id,actor.name,kind,JSON.stringify(changes)]);
}
