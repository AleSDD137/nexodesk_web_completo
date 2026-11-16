/** Advanced inventory: previews are signed, commits revalidate under locks. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response, RequestHandler } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireAuth, requireRole, STAFF, MANAGERS } from './auth.js';
import { transaction } from './ticket-audit.js';
import { csvInputs, csvDocument, REQUIRED_COLUMNS, OPTIONAL_COLUMNS, CsvError } from './inventory-csv.js';
import { recordAssetChange } from './inventory-history.js';

const route=(fn:(req:Request,res:Response)=>Promise<void>):RequestHandler=>(req,res,next)=>{void fn(req,res).catch(next);};
const fields=`a.id,a.kind,a.brand,a.serial,a.owner_name AS "owner",a.location,a.state,
  a.ticket_id AS "ticketId",a.owner_user_id AS "ownerUserId",to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;
const states=['Disponible','Asignado','En reparación','Baja'] as const;
const numeric=z.number().int().positive().safe();
const textId=z.string().refine(s=>s===''||/^[1-9]\d*$/.test(s)&&Number.isSafeInteger(Number(s)),'ID inválido').transform(s=>s===''?null:Number(s));
const record=z.object({kind:z.enum(['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro']),
  brand:z.string().min(2).max(100),serial:z.string().min(2).max(70),owner:z.string().min(2).max(120),
  location:z.string().min(2).max(120),state:z.enum(states),ticketId:textId.optional(),ownerUserId:textId.optional()}).strict();
type AssetInput=z.infer<typeof record>;
type PreviewRow={line:number;serial:string;action:'create'|'update';errors:string[];value:AssetInput|null;existingId:string|null};
type Snapshot={id:string;updatedAt:string};
const input=z.object({csv:z.string().min(1).max(24_000),updateExisting:z.boolean().default(false)}).strict();
const filters=z.object({search:z.string().trim().max(100).default(''),state:z.enum(states).optional()});
const filter=`($1='' OR a.brand ILIKE $2 OR a.serial ILIKE $2 OR a.owner_name ILIKE $2 OR a.location ILIKE $2)
  AND ($3::text IS NULL OR a.state=$3)`;
const signingKey=randomBytes(32);
const sign=(payload:string)=>createHmac('sha256',signingKey).update(payload).digest('base64url');
function issueToken(csv:string,updateExisting:boolean,actor:number,snapshot:Snapshot[]):string {
  const payload=Buffer.from(JSON.stringify({csvHash:sign(csv),updateExisting,actor,snapshot,until:Date.now()+15*60_000})).toString('base64url');
  return payload+'.'+sign(payload);
}
function tokenData(token:string,csv:string,updateExisting:boolean,actor:number):Snapshot[]{
  const [payload,signature,...extra]=token.split('.');
  const expected=sign(payload||'');
  if(extra.length||!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error('Vista previa inválida. Volvé a previsualizar.');
  const raw:unknown=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  const value=z.object({csvHash:z.string(),updateExisting:z.boolean(),actor:numeric,
    snapshot:z.array(z.object({id:z.string(),updatedAt:z.string()}).strict()).max(200),until:z.number()}).strict().parse(raw);
  if(value.csvHash!==sign(csv)||value.updateExisting!==updateExisting||value.actor!==actor||value.until<Date.now())throw Error('La vista previa cambió o venció. Volvé a previsualizar.');
  return value.snapshot;
}
async function preview(client:PoolClient,csv:string,updateExisting:boolean){
  const inputs=csvInputs(csv),serials=inputs.map(row=>row.value.serial.toLocaleLowerCase('es'));
  const existing=await client.query(`SELECT ${fields} FROM assets a WHERE lower(a.serial)=ANY($1::text[]) ORDER BY a.id`,[serials]);
  const bySerial=new Map(existing.rows.map(row=>[row.serial.toLocaleLowerCase('es'),row]));
  const rows:PreviewRow[]=inputs.map(row=>{
    const parsed=record.safeParse(row.value),old=bySerial.get(row.value.serial.toLocaleLowerCase('es'));
    return {line:row.line,serial:row.value.serial,action:old?'update':'create',existingId:old?String(old.id):null,
      value:parsed.success?parsed.data:null,
      errors:[...row.errors,...(parsed.success?[]:parsed.error.issues.map(e=>e.path.join('.')+': '+e.message)),
        ...(old&&!updateExisting?['La serie ya existe. Autorizá actualizaciones y repetí la vista previa.']:[])]};
  });
  for(const row of rows){
    if(!row.value)continue;
    if(row.value.ticketId!=null&&!(await client.query('SELECT 1 FROM tickets WHERE id=$1',[row.value.ticketId])).rowCount)row.errors.push('ticketId: ticket inexistente.');
    if(row.value.ownerUserId!=null&&!(await client.query('SELECT 1 FROM users WHERE id=$1 AND active=true',[row.value.ownerUserId])).rowCount)row.errors.push('ownerUserId: cuenta inexistente o inactiva.');
  }
  const snapshot:Snapshot[]=existing.rows.map(row=>({id:String(row.id),updatedAt:row.updatedAt}));
  return {rows,snapshot,valid:rows.every(row=>row.errors.length===0),existing:bySerial};
}

export function registerInventoryRoutes(app:Express):void {
  const staff=[requireAuth,requireRole(...STAFF)],managers=[requireAuth,requireRole(...MANAGERS)];
  app.get('/api/inventory/assets',...staff,route(async(req,res)=>{
    const query=filters.extend({limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict().parse(req.query);
    const data=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const values=[query.search,`%${query.search}%`,query.state??null];
      const total=await client.query(`SELECT count(*)::int AS total FROM assets a WHERE ${filter}`,values);
      const page=await client.query(`SELECT ${fields},u.name AS "ownerUserName" FROM assets a LEFT JOIN users u ON u.id=a.owner_user_id
        WHERE ${filter} ORDER BY a.id DESC LIMIT $4 OFFSET $5`,[...values,query.limit,query.offset]);
      return {data:page.rows,total:total.rows[0].total,limit:query.limit,offset:query.offset};
    });res.json(data);
  }));
  app.get('/api/inventory/export',...staff,route(async(req,res)=>{
    const query=filters.extend({format:z.enum(['csv','json']).default('csv')}).strict().parse(req.query),values=[query.search,`%${query.search}%`,query.state??null];
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const total=await client.query(`SELECT count(*)::int AS n FROM assets a WHERE ${filter}`,values);
      if(total.rows[0].n>10000)return null;
      return (await client.query(`SELECT ${fields} FROM assets a WHERE ${filter} ORDER BY a.id`,values)).rows;
    });
    if(result===null){res.status(422).json({error:'Más de 10000 activos. Refiná los filtros antes de exportar.'});return;}
    const csv=csvDocument([...REQUIRED_COLUMNS,...OPTIONAL_COLUMNS],result);
    if(query.format==='json'){res.json({data:{csv,filename:'nexodesk-inventory.csv',total:result.length}});return;}
    res.type('text/csv').attachment('nexodesk-inventory.csv').send(csv);
  }));
  app.get('/api/inventory/assets/:id/history',...staff,route(async(req,res)=>{
    const id=z.coerce.number().int().positive().safe().parse(req.params.id);
    const page=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict().parse(req.query);
    const result=await transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      if(!(await client.query('SELECT 1 FROM assets WHERE id=$1',[id])).rowCount)return null;
      const count=await client.query('SELECT count(*)::int AS n FROM asset_events WHERE asset_id=$1',[id]);
      const data=await client.query(`SELECT id,asset_id AS "assetId",actor_name AS "actorName",kind,changes,created_at AS "createdAt"
        FROM asset_events WHERE asset_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,[id,page.limit,page.offset]);
      return {data:data.rows,total:count.rows[0].n,...page};
    });
    if(result===null){res.status(404).json({error:'Activo no encontrado'});return;}res.json(result);
  }));
  app.post('/api/inventory/import/preview',...managers,route(async(req,res)=>{
    const form=input.parse(req.body);
    try{
      const result=await transaction(async client=>{
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        return preview(client,form.csv,form.updateExisting);
      });
      res.json({data:{rows:result.rows,valid:result.valid,total:result.rows.length,
        token:result.valid?issueToken(form.csv,form.updateExisting,req.currentUser!.id,result.snapshot):null}});
    }catch(error){if(error instanceof CsvError){res.status(400).json({error:error.message});return;}throw error;}
  }));
  app.post('/api/inventory/import/commit',...managers,route(async(req,res)=>{
    const form=input.extend({token:z.string().min(1).max(100_000)}).parse(req.body);
    let expected:Snapshot[];
    try{expected=tokenData(form.token,form.csv,form.updateExisting,req.currentUser!.id);}
    catch{res.status(409).json({error:'Vista previa inválida o vencida. Volvé a previsualizar.'});return;}
    const result=await transaction(async client=>{
      // Serialize all inventory writes while validating current serials/snapshot.
      await client.query('LOCK TABLE assets IN SHARE ROW EXCLUSIVE MODE');
      const checked=await preview(client,form.csv,form.updateExisting);
      if(!checked.valid||JSON.stringify(expected)!==JSON.stringify(checked.snapshot))return null;
      let created=0,updated=0;
      for(const row of checked.rows){
        const a=row.value!,before=checked.existing.get(a.serial.toLocaleLowerCase('es'));
        const ticketId=a.ticketId===undefined?before?.ticketId??null:a.ticketId;
        const ownerUserId=a.ownerUserId===undefined?before?.ownerUserId??null:a.ownerUserId;
        const params=[a.kind,a.brand,a.serial,a.owner,a.location,a.state,ticketId,ownerUserId];
        const saved=before
          ? await client.query(`UPDATE assets a SET kind=$1,brand=$2,serial=$3,owner_name=$4,location=$5,state=$6,
              ticket_id=$7,owner_user_id=$8,updated_at=clock_timestamp() WHERE a.id=$9 RETURNING ${fields}`,[...params,before.id])
          : await client.query(`INSERT INTO assets AS a(kind,brand,serial,owner_name,location,state,ticket_id,owner_user_id)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${fields}`,params);
        await recordAssetChange(client,before??{},saved.rows[0],req.currentUser!,'imported');
        if(before)updated++;else created++;
      }
      return {created,updated,total:checked.rows.length};
    });
    if(!result){res.status(409).json({error:'Los datos cambiaron o la importación no es válida. Repetí la vista previa.'});return;}
    res.status(201).json({data:result});
  }));
}
