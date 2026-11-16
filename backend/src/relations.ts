/** V2.5 relationships: explicit identifiers, additional links and bounded reads. */
import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { recordAssetChange } from './inventory-history.js';
import { requireAuth, requireRole, STAFF } from './auth.js';
import { transaction } from './ticket-audit.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>
  (req,res,next)=>{void fn(req,res).catch(next);};
const id=z.number().int().positive().safe();
const getId=(raw:string)=>z.coerce.number().int().positive().safe().parse(raw);
const pagination=z.object({
  limit:z.coerce.number().int().min(1).max(100).default(20),
  offset:z.coerce.number().int().min(0).max(1_000_000).default(0)
});
const searchPage=pagination.extend({search:z.string().trim().max(120).default('')}).strict();
const detailPage=pagination.extend({limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
const assetFields=`a.id,a.kind,a.brand,a.serial,a.owner_name AS "owner",a.location,a.state,
  a.ticket_id AS "ticketId",a.owner_user_id AS "ownerUserId",u.name AS "ownerUserName",
  a.created_at AS "createdAt",a.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM (
    SELECT l.ticket_id FROM asset_ticket_links l WHERE l.asset_id=a.id
    UNION SELECT a.ticket_id WHERE a.ticket_id IS NOT NULL
  ) links) AS "linkedCount"`;
const assetSearch=`($1='' OR a.serial ILIKE $2 OR a.brand ILIKE $2 OR a.location ILIKE $2 OR a.kind ILIKE $2)`;
const linkedTickets=`WITH links AS (
  SELECT ticket_id,true AS principal,false AS additional FROM assets WHERE id=$1 AND ticket_id IS NOT NULL
  UNION ALL SELECT ticket_id,false,true FROM asset_ticket_links WHERE asset_id=$1
), combined AS (
  SELECT ticket_id,bool_or(principal) AS principal,bool_or(additional) AS additional
  FROM links GROUP BY ticket_id
)`;

export function registerRelationsRoutes(app:Express):void {
  const staff=[requireAuth,requireRole(...STAFF)];
  app.get('/api/relations/assets',...staff,route(async(req,res)=>{
    const query=searchPage.parse(req.query),values=[query.search,`%${query.search}%`];
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const total=await client.query(`SELECT count(*)::int AS n FROM assets a WHERE ${assetSearch}`,values);
      const rows=await client.query(`SELECT ${assetFields} FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id
        WHERE ${assetSearch} ORDER BY a.id DESC LIMIT $3 OFFSET $4`,[...values,query.limit,query.offset]);
      return {data:rows.rows,total:total.rows[0].n,limit:query.limit,offset:query.offset};
    });
    res.json(result);
  }));

  app.get('/api/relations/assets/:id',...staff,route(async(req,res)=>{
    const assetId=getId(req.params.id),page=detailPage.parse(req.query);
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const asset=await client.query(`SELECT ${assetFields},u.role AS "ownerUserRole",u.active AS "ownerUserActive"
        FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1`,[assetId]);
      if(!asset.rowCount)return null;
      const count=await client.query(`${linkedTickets} SELECT count(*)::int AS n FROM combined`,[assetId]);
      const tickets=await client.query(`${linkedTickets}
        SELECT t.id,t.title,t.type,t.status,t.priority,t.assignee,c.principal AS "primary",c.additional
        FROM combined c JOIN tickets t ON t.id=c.ticket_id
        ORDER BY c.principal DESC,t.id DESC LIMIT $2 OFFSET $3`,[assetId,page.limit,page.offset]);
      const {ownerUserRole,ownerUserActive,...record}=asset.rows[0];
      return {asset:record,tickets:tickets.rows,total:count.rows[0].n,limit:page.limit,offset:page.offset,
        ownerUser:record.ownerUserId==null?null:{id:record.ownerUserId,name:record.ownerUserName,role:ownerUserRole,active:ownerUserActive}};
    });
    if(result===null){res.status(404).json({error:'Activo no encontrado'});return;}
    res.json({data:result});
  }));

  app.get('/api/relations/tickets',...staff,route(async(req,res)=>{
    const query=searchPage.parse(req.query),values=[query.search,`%${query.search}%`];
    const filter=`($1='' OR t.id::text=$1 OR t.title ILIKE $2)`;
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const total=await client.query(`SELECT count(*)::int AS n FROM tickets t WHERE ${filter}`,values);
      const rows=await client.query(`SELECT t.id,t.title,t.type,t.status,t.priority,t.assignee FROM tickets t
        WHERE ${filter} ORDER BY t.id DESC LIMIT $3 OFFSET $4`,[...values,query.limit,query.offset]);
      return {data:rows.rows,total:total.rows[0].n,limit:query.limit,offset:query.offset};
    });
    res.json(result);
  }));

  app.get('/api/relations/users',...staff,route(async(req,res)=>{
    const query=searchPage.parse(req.query),values=[query.search,`%${query.search}%`];
    const filter=`u.active=true AND ($1='' OR u.id::text=$1 OR u.name ILIKE $2)`;
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const total=await client.query(`SELECT count(*)::int AS n FROM users u WHERE ${filter}`,values);
      const rows=await client.query(`SELECT u.id,u.name,u.role FROM users u
        WHERE ${filter} ORDER BY u.name,u.id LIMIT $3 OFFSET $4`,[...values,query.limit,query.offset]);
      return {data:rows.rows,total:total.rows[0].n,limit:query.limit,offset:query.offset};
    });
    res.json(result);
  }));

  app.get('/api/relations/tickets/:id/assets',...staff,route(async(req,res)=>{
    const ticketId=getId(req.params.id),page=pagination.strict().parse(req.query);
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      if(!(await client.query('SELECT 1 FROM tickets WHERE id=$1',[ticketId])).rowCount)return null;
      const filter=`(a.ticket_id=$1 OR EXISTS(SELECT 1 FROM asset_ticket_links l WHERE l.asset_id=a.id AND l.ticket_id=$1))`;
      const count=await client.query(`SELECT count(*)::int AS n FROM assets a WHERE ${filter}`,[ticketId]);
      const rows=await client.query(`SELECT ${assetFields},COALESCE(a.ticket_id=$1,false) AS "primary",
        EXISTS(SELECT 1 FROM asset_ticket_links l WHERE l.asset_id=a.id AND l.ticket_id=$1) AS additional
        FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE ${filter}
        ORDER BY a.id DESC LIMIT $2 OFFSET $3`,[ticketId,page.limit,page.offset]);
      return {data:rows.rows,total:count.rows[0].n,limit:page.limit,offset:page.offset};
    });
    if(result===null){res.status(404).json({error:'Ticket no encontrado'});return;}
    res.json(result);
  }));

  app.post('/api/relations/links',...staff,route(async(req,res)=>{
    const form=z.object({assetId:id,ticketId:id}).strict().parse(req.body);
    const result=await transaction(async client=>{
      const asset=await client.query('SELECT ticket_id FROM assets WHERE id=$1 FOR UPDATE',[form.assetId]);
      if(!asset.rowCount)return {status:404,error:'Activo no encontrado'};
      if(!(await client.query('SELECT 1 FROM tickets WHERE id=$1 FOR KEY SHARE',[form.ticketId])).rowCount)
        return {status:404,error:'Ticket no encontrado'};
      if(String(asset.rows[0].ticket_id)===String(form.ticketId) ||
        (await client.query('SELECT 1 FROM asset_ticket_links WHERE asset_id=$1 AND ticket_id=$2',[form.assetId,form.ticketId])).rowCount)
        return {status:409,error:'El activo y el ticket ya están vinculados'};
      const {rows}=await client.query(`INSERT INTO asset_ticket_links(asset_id,ticket_id,created_by)
        VALUES($1,$2,$3) RETURNING asset_id AS "assetId",ticket_id AS "ticketId",created_by AS "createdBy",created_at AS "createdAt"`,
        [form.assetId,form.ticketId,req.currentUser!.id]);
      return {status:201,data:rows[0]};
    });
    if('error'in result){res.status(result.status).json({error:result.error});return;}
    res.status(result.status).json({data:result.data});
  }));

  app.delete('/api/relations/links/:assetId/:ticketId',...staff,route(async(req,res)=>{
    const assetId=getId(req.params.assetId),ticketId=getId(req.params.ticketId);
    z.object({}).strict().parse(req.body??{});
    const result=await transaction(async client=>{
      const asset=await client.query('SELECT ticket_id FROM assets WHERE id=$1 FOR UPDATE',[assetId]);
      if(!asset.rowCount)return {status:404,error:'Activo no encontrado'};
      if(String(asset.rows[0].ticket_id)===String(ticketId))return {status:409,error:'El vínculo principal se administra desde Assets y no puede eliminarse aquí'};
      const removed=await client.query('DELETE FROM asset_ticket_links WHERE asset_id=$1 AND ticket_id=$2 RETURNING asset_id',[assetId,ticketId]);
      if(!removed.rowCount)return {status:404,error:'Vínculo adicional no encontrado'};
      return {status:200,data:{assetId,ticketId}};
    });
    if('error'in result){res.status(result.status).json({error:result.error});return;}
    res.json({data:result.data});
  }));

  app.put('/api/relations/assets/:id/owner',...staff,route(async(req,res)=>{
    const assetId=getId(req.params.id),form=z.object({userId:id.nullable()}).strict().parse(req.body);
    const result=await transaction(async client=>{
      const previous=await client.query('SELECT id,owner_user_id AS "ownerUserId" FROM assets WHERE id=$1 FOR UPDATE',[assetId]);
      if(!previous.rowCount)
        return {status:404,error:'Activo no encontrado'};
      if(form.userId!==null && !(await client.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE',[form.userId])).rowCount)
        return {status:400,error:'Elegí una cuenta registrada y activa'};
      await client.query('UPDATE assets SET owner_user_id=$1,updated_at=clock_timestamp() WHERE id=$2',[form.userId,assetId]);
      const {rows}=await client.query(`SELECT ${assetFields} FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1`,[assetId]);
      await recordAssetChange(client,previous.rows[0],{id:assetId,ownerUserId:form.userId},req.currentUser!,'owner_linked');
      return {status:200,data:rows[0]};
    });
    if('error'in result){res.status(result.status).json({error:result.error});return;}
    res.json({data:result.data});
  }));
}
