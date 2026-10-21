/** NEXODESK V2.3: Assets, Triage y Portal sobre PostgreSQL.
 * Todo endpoint con datos reales exige cookie de sesión V2.2.
 */
import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { requireAuth, requireRole, STAFF } from './auth.js';

const route = (fn:(req:Request,res:Response)=>Promise<void>):RequestHandler =>
  (req,res,next)=>{Promise.resolve(fn(req,res)).catch(next);};
const idParam=(raw:string)=>z.coerce.number().int().positive().safe().parse(raw);
const kind=z.enum(['Notebook','Tablet','Teléfono','Monitor','Impresora','Otro']);
const assetState=z.enum(['Disponible','Asignado','En reparación','Baja']);
const assetBody=z.object({
  kind,brand:z.string().trim().min(2).max(100),serial:z.string().trim().min(2).max(70),
  owner:z.string().trim().min(2).max(120),location:z.string().trim().min(2).max(120),
  state:assetState,ticketId:z.number().int().positive().safe().nullable()
}).strict();
const assetFields=`id,kind,brand,serial,owner_name AS "owner",location,state,
  ticket_id AS "ticketId",created_at AS "createdAt",updated_at AS "updatedAt"`;
const categories=['Sin clasificar','Redes / VPN','Cuentas y accesos','Software','Hardware','Correo','Impresión','Otro'] as const;
const impacts=['Bajo','Medio','Alto'] as const;
const urgencies=['Baja','Media','Alta'] as const;
const classify=z.object({category:z.enum(categories),impact:z.enum(impacts),urgency:z.enum(urgencies),
  diagnosis:z.string().trim().max(2500),newTest:z.string().trim().max(750).default(''),
  applyPriority:z.boolean().default(false)}).strict();
const transfer=z.object({toLevel:z.number().int().min(1).max(3),reason:z.string().trim().min(10).max(1800),
  pending:z.string().trim().min(10).max(1500),assigneeUserId:z.number().int().positive().safe().nullable().default(null)}).strict();
const portalCreate=z.object({title:z.string().trim().min(3).max(160),description:z.string().trim().min(5).max(5000),
  type:z.enum(['Incidente','Requerimiento','Consulta'])}).strict();
const triageFields=`ticket_id AS "ticketId",category,impact,urgency,level,diagnosis,
  updated_by AS "updatedBy",updated_at AS "updatedAt"`;

async function getTriage(ticketId:number){
  const {rows}=await pool.query(`SELECT ${triageFields} FROM triage_cases WHERE ticket_id=$1`,[ticketId]);
  const record=rows[0]??{ticketId,category:'Sin clasificar',impact:'Medio',urgency:'Media',
    level:1,diagnosis:'',updatedBy:null,updatedAt:null};
  const [tests,events]=await Promise.all([
    pool.query(`SELECT id,description,created_at AS "createdAt",created_by AS "createdBy" FROM triage_tests WHERE ticket_id=$1 ORDER BY id`,[ticketId]),
    pool.query(`SELECT id,kind,from_level AS "fromLevel",to_level AS "toLevel",note,pending,
      created_at AS "createdAt",created_by AS "createdBy" FROM triage_events WHERE ticket_id=$1 ORDER BY id DESC LIMIT 100`,[ticketId])
  ]);
  return {...record,tests:tests.rows,history:events.rows};
}

export function registerV23Routes(app:Express):void {
  // Inventario: información interna; los solicitantes no pueden enumerar equipos o series.
  app.get('/api/assets',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const parsed=z.object({search:z.string().trim().max(100).optional()}).safeParse(req.query);
    if(!parsed.success){res.status(400).json({error:'Búsqueda inválida'});return;}
    const query=parsed.data.search||'';
    const {rows}=await pool.query(`SELECT ${assetFields} FROM assets
      WHERE $1='' OR brand ILIKE $2 OR serial ILIKE $2 OR owner_name ILIKE $2 OR location ILIKE $2
      ORDER BY id DESC LIMIT 200`,[query,`%${query}%`]);
    res.json({data:rows,limit:200});
  }));
  app.post('/api/assets',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const a=assetBody.parse(req.body);
    const {rows}=await pool.query(`INSERT INTO assets(kind,brand,serial,owner_name,location,state,ticket_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${assetFields}`,
      [a.kind,a.brand,a.serial,a.owner,a.location,a.state,a.ticketId]);
    res.status(201).json({data:rows[0]});
  }));
  app.patch('/api/assets/:id',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=idParam(req.params.id);const a=assetBody.parse(req.body);
    const {rows}=await pool.query(`UPDATE assets SET kind=$1,brand=$2,serial=$3,owner_name=$4,
      location=$5,state=$6,ticket_id=$7,updated_at=now() WHERE id=$8 RETURNING ${assetFields}`,
      [a.kind,a.brand,a.serial,a.owner,a.location,a.state,a.ticketId,id]);
    if(!rows.length){res.status(404).json({error:'Activo no encontrado'});return;}
    res.json({data:rows[0]});
  }));

  app.get('/api/triage/assignees',requireAuth,requireRole(...STAFF),route(async(_req,res)=>{
    const {rows}=await pool.query(`SELECT id,name,role,support_level AS "supportLevel" FROM users
      WHERE active=true AND role IN ('Administrador','Coordinador','Técnico') ORDER BY name LIMIT 200`);
    res.json({data:rows});
  }));
  app.get('/api/triage/summary',requireAuth,requireRole(...STAFF),route(async(_req,res)=>{
    const {rows}=await pool.query(`SELECT count(*)::int AS reviewed,
      count(*) FILTER(WHERE level>1)::int AS escalated FROM triage_cases`);
    res.json({data:rows[0]});
  }));
  app.get('/api/triage/:ticketId',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=idParam(req.params.ticketId);
    const exists=await pool.query('SELECT 1 FROM tickets WHERE id=$1',[id]);
    if(!exists.rowCount){res.status(404).json({error:'Ticket no encontrado'});return;}
    res.json({data:await getTriage(id)});
  }));
  app.put('/api/triage/:ticketId',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=idParam(req.params.ticketId),form=classify.parse(req.body);
    const score=({Bajo:1,Medio:2,Alto:3}[form.impact])*({Baja:1,Media:2,Alta:3}[form.urgency]);
    const suggested=score>=6?'Alta':score>=3?'Media':'Baja';
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const ticket=await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE',[id]);
      if(!ticket.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Ticket no encontrado'});return;}
      await client.query(`INSERT INTO triage_cases(ticket_id,category,impact,urgency,diagnosis,updated_by)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(ticket_id) DO UPDATE SET category=EXCLUDED.category,
        impact=EXCLUDED.impact,urgency=EXCLUDED.urgency,diagnosis=EXCLUDED.diagnosis,
        updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [id,form.category,form.impact,form.urgency,form.diagnosis,req.currentUser!.id]);
      if(form.newTest) await client.query('INSERT INTO triage_tests(ticket_id,description,created_by) VALUES($1,$2,$3)',
        [id,form.newTest,req.currentUser!.id]);
      await client.query(`INSERT INTO triage_events(ticket_id,kind,note,created_by) VALUES($1,'Diagnóstico actualizado',$2,$3)`,
        [id,`${form.category} · Impacto ${form.impact} · Urgencia ${form.urgency}${form.newTest?' · Nueva prueba registrada':''}`,req.currentUser!.id]);
      if(form.applyPriority)await client.query('UPDATE tickets SET priority=$1,updated_at=now() WHERE id=$2',[suggested,id]);
      await client.query('COMMIT');
    } catch(err){await client.query('ROLLBACK');throw err;} finally{client.release();}
    res.json({data:await getTriage(id),suggestedPriority:suggested,priorityApplied:form.applyPriority});
  }));
  app.post('/api/triage/:ticketId/transfer',requireAuth,requireRole(...STAFF),route(async(req,res)=>{
    const id=idParam(req.params.ticketId),form=transfer.parse(req.body);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      // Bloquear el ticket antes del caso: igual orden que en clasificación.
      const ticket=await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE',[id]);
      if(!ticket.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'Ticket no encontrado'});return;}
      const current=await client.query('SELECT level,diagnosis FROM triage_cases WHERE ticket_id=$1 FOR UPDATE',[id]);
      const row=current.rows[0];
      const tests=row?await client.query('SELECT 1 FROM triage_tests WHERE ticket_id=$1 LIMIT 1',[id]):null;
      if(!row?.diagnosis?.trim() || !tests?.rowCount){await client.query('ROLLBACK');res.status(409).json({error:'Registrá diagnóstico y al menos una prueba antes de transferir.'});return;}
      if(Number(row.level)===form.toLevel){await client.query('ROLLBACK');res.status(400).json({error:'El nivel de destino debe ser distinto del actual.'});return;}
      let assigneeName:string|null=null;
      if(form.assigneeUserId!==null){
        const target=await client.query(`SELECT name FROM users WHERE id=$1 AND active=true
          AND role IN ('Administrador','Coordinador','Técnico')`,[form.assigneeUserId]);
        if(!target.rowCount){await client.query('ROLLBACK');res.status(400).json({error:'Técnico destino inválido'});return;}
        assigneeName=target.rows[0].name;
      }
      await client.query('UPDATE triage_cases SET level=$1,updated_by=$2,updated_at=now() WHERE ticket_id=$3',
        [form.toLevel,req.currentUser!.id,id]);
      await client.query(`INSERT INTO triage_events(ticket_id,kind,from_level,to_level,note,pending,created_by)
        VALUES($1,'Transferencia',$2,$3,$4,$5,$6)`,[id,row.level,form.toLevel,form.reason,form.pending,req.currentUser!.id]);
      if(assigneeName!==null)await client.query('UPDATE tickets SET assignee=$1,updated_at=now() WHERE id=$2',[assigneeName,id]);
      await client.query('COMMIT');
    } catch(err){await client.query('ROLLBACK');throw err;} finally{client.release();}
    res.json({data:await getTriage(id)});
  }));

  // Portal autenticado: identidad, estado, prioridad y origen NO vienen del cliente.
  app.get('/api/portal/my-requests',requireAuth,route(async(req,res)=>{
    const {rows}=await pool.query(`SELECT id,title,type,priority,status,created_at AS "createdAt"
      FROM tickets WHERE requester_email=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[req.currentUser!.email]);
    res.json({data:rows,limit:100});
  }));
  app.post('/api/portal/requests',requireAuth,route(async(req,res)=>{
    const t=portalCreate.parse(req.body);const self=req.currentUser!;
    const {rows}=await pool.query(`INSERT INTO tickets(title,description,type,priority,status,requester,
      requester_email,assignee,comments,source) VALUES($1,$2,$3,'Media','Registrado',$4,$5,
      'Sin asignar','[]'::jsonb,'Portal') RETURNING id,title,type,priority,status,created_at AS "createdAt"`,
      [t.title,t.description,t.type,self.name,self.email]);
    res.status(201).json({data:rows[0]});
  }));
  app.get('/api/portal/requests/:id',requireAuth,route(async(req,res)=>{
    const id=idParam(req.params.id);
    const {rows}=await pool.query(`SELECT id,title,type,priority,status,description,created_at AS "createdAt"
      FROM tickets WHERE id=$1 AND requester_email=$2`,[id,req.currentUser!.email]);
    if(!rows.length){res.status(404).json({error:'Solicitud no encontrada o sin permiso'});return;}
    res.json({data:rows[0]});
  }));
}
