import 'dotenv/config';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import { pool } from './db.js';
import { registerV23Routes } from './modules-v23.js';
import {
  hashPassword, verifyPassword, passwordError, issueSession, revokeSession, revokeUserSessions,
  clearSessionCookie, requireAuth, requireRole, STAFF, MANAGERS
} from './auth.js';

const app = express();
app.disable('x-powered-by');
const origins = (process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5500,http://localhost:5500')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({origin(origin,cb){ cb(null,!origin || origins.includes(origin)); },credentials:true}));
app.use(express.json({limit:'32kb'}));
const asyncRoute = (fn: (req:express.Request,res:express.Response)=>Promise<void>):RequestHandler =>
  (req,res,next)=>{Promise.resolve(fn(req,res)).catch(next);};

// JSON + Origin válido para mutaciones con cookies (defensa CSRF adicional a SameSite=Strict).
app.use('/api',(req,res,next)=>{
  if(['POST','PATCH','PUT','DELETE'].includes(req.method)){
    const origin=req.get('Origin');
    if(origin && !origins.includes(origin)){res.status(403).json({error:'Origen no permitido'});return;}
    if(!req.is('application/json')){res.status(415).json({error:'Se requiere Content-Type: application/json'});return;}
  }
  next();
});

const states=['Registrado','En revisión','En atención','Validación','Cerrado'] as const;
const priorities=['Baja','Media','Alta','Crítica'] as const;
const types=['Incidente','Requerimiento','Consulta'] as const;
const roles=['Administrador','Coordinador','Técnico','Solicitante'] as const;
const emailSchema=z.string().trim().toLowerCase().email().max(254);
const idSchema=z.coerce.number().int().positive().safe();
const getId=(raw:string)=>idSchema.parse(raw);
const userFields=`id,name,email,role,active,support_level AS "supportLevel",(password_hash IS NOT NULL) AS "hasPassword"`;
const ticketFields=`id,title,description,type,priority,status,requester,requester_email AS "requesterEmail",assignee,comments,source,created_at AS "createdAt",updated_at AS "updatedAt"`;
const ticketCreate=z.object({
  title:z.string().trim().min(3).max(160),description:z.string().max(10000).default(''),
  type:z.enum(types).default('Incidente'),priority:z.enum(priorities).default('Media'),
  status:z.enum(states).default('Registrado'),
  requester:z.string().trim().min(2).max(120),requesterEmail:emailSchema.optional(),
  assignee:z.string().trim().min(2).max(120).default('Sin asignar'),
  source:z.string().trim().max(40).default('Dashboard'),
  comments:z.array(z.object({author:z.string(),date:z.string(),text:z.string()})).max(100).default([])
}).strict();
const ticketPatch=ticketCreate.omit({comments:true,requesterEmail:true,source:true}).partial()
  .refine(d=>Object.keys(d).length>0,'Enviá al menos un cambio');
const commentInput=z.object({text:z.string().trim().min(1).max(2000)}).strict();
const loginSchema=z.object({email:emailSchema,password:z.string().min(1).max(128)}).strict();
const newUserSchema=z.object({
  name:z.string().trim().min(2).max(120),email:emailSchema,password:z.string(),
  role:z.enum(roles),supportLevel:z.number().int().min(1).max(3).nullable().optional()
}).strict().superRefine((u,ctx)=>{
  if(passwordError(u.password))ctx.addIssue({code:'custom',path:['password'],message:passwordError(u.password)!});
  if(u.role==='Técnico' && !u.supportLevel)ctx.addIssue({code:'custom',path:['supportLevel'],message:'Indicar nivel 1, 2 o 3'});
  if(u.role!=='Técnico' && u.supportLevel!=null)ctx.addIssue({code:'custom',path:['supportLevel'],message:'Solo los técnicos tienen nivel'});
});
const changePasswordSchema=z.object({currentPassword:z.string(),newPassword:z.string()}).strict();
const updateUserSchema=z.object({active:z.boolean()}).strict();

const attempts=new Map<string,{count:number,expires:number}>();
const dummyHashPromise=hashPassword('NEXODESK-usuario-inexistente-2026');
function throttle(key:string,limit:number):boolean{
  const now=Date.now();if(attempts.size>2000){for(const [k,v] of attempts)if(v.expires<now)attempts.delete(k);}
  const a=attempts.get(key);return !!a&&a.expires>now&&a.count>=limit;
}
function failedLogin(key:string){
  const now=Date.now();const a=attempts.get(key);attempts.set(key,{count:(a&&a.expires>now?a.count:0)+1,expires:now+15*60_000});
}
// Salud sin revelar datos personales.
app.get('/api/health',asyncRoute(async(_req,res)=>{
  await pool.query('SELECT 1');res.json({ok:true,service:'NEXODESK API',database:'connected'});
}));

app.post('/api/auth/login',asyncRoute(async(req,res)=>{
  const input=loginSchema.parse(req.body);
  const ip=req.ip||'unknown';const key=`${ip}|${input.email}`;
  if(throttle(key,8)||throttle(`ip|${ip}`,40)){res.status(429).json({error:'Demasiados intentos. Esperá 15 minutos.'});return;}
  const {rows}=await pool.query(`SELECT id,password_hash,active FROM users WHERE email=$1`,[input.email]);
  const record=rows[0];
  // Ejecutar bcrypt incluso si el usuario no existe para reducir diferencias de tiempo.
  const hash=record?.password_hash ?? await dummyHashPromise;
  const valid=await verifyPassword(input.password,hash);
  if(!valid||!record?.active||!record.password_hash){
    failedLogin(key);failedLogin(`ip|${ip}`);
    res.status(401).json({error:'Correo o contraseña incorrectos.'});return;
  }
  attempts.delete(key);attempts.delete(`ip|${ip}`);
  await issueSession(res,Number(record.id));
  const data=await pool.query(`SELECT ${userFields} FROM users WHERE id=$1`,[record.id]);
  res.json({user:data.rows[0]});
}));
app.get('/api/auth/me',requireAuth,asyncRoute(async(req,res)=>{
  res.json({user:req.currentUser});
}));
app.post('/api/auth/logout',asyncRoute(async(req,res)=>{
  await revokeSession(req);clearSessionCookie(res);res.json({ok:true});
}));
app.post('/api/auth/change-password',requireAuth,asyncRoute(async(req,res)=>{
  const input=changePasswordSchema.parse(req.body);
  const problem=passwordError(input.newPassword);
  if(problem){res.status(400).json({error:problem});return;}
  const id=req.currentUser!.id;
  const result=await pool.query('SELECT password_hash FROM users WHERE id=$1',[id]);
  if(!result.rows[0]?.password_hash || !(await verifyPassword(input.currentPassword,result.rows[0].password_hash))){
    res.status(400).json({error:'Contraseña actual incorrecta'});return;
  }
  const hash=await hashPassword(input.newPassword);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,id]);
  await revokeUserSessions(id);await issueSession(res,id);
  res.json({ok:true});
}));

app.get('/api/users',requireAuth,requireRole(...MANAGERS),asyncRoute(async(_req,res)=>{
  const {rows}=await pool.query(`SELECT ${userFields} FROM users ORDER BY name`);res.json({data:rows});
}));
app.post('/api/users',requireAuth,requireRole('Administrador'),asyncRoute(async(req,res)=>{
  const u=newUserSchema.parse(req.body);const hash=await hashPassword(u.password);
  const {rows}=await pool.query(`INSERT INTO users(name,email,role,support_level,password_hash,active)
    VALUES($1,$2,$3,$4,$5,true) RETURNING ${userFields}`,
    [u.name,u.email,u.role,u.role==='Técnico'?u.supportLevel:null,hash]);
  res.status(201).json({user:rows[0]});
}));
app.post('/api/users/:id/reset-password',requireAuth,requireRole('Administrador'),asyncRoute(async(req,res)=>{
  const id=getId(req.params.id);
  if(id===req.currentUser!.id){res.status(400).json({error:'Para tu propia contraseña usá Configuración.'});return;}
  const data=z.object({password:z.string()}).strict().parse(req.body);
  const problem=passwordError(data.password);
  if(problem){res.status(400).json({error:problem});return;}
  const hash=await hashPassword(data.password);
  const result=await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id',[hash,id]);
  if(!result.rowCount){res.status(404).json({error:'Usuario no encontrado'});return;}
  await revokeUserSessions(id);
  res.json({ok:true});
}));
app.patch('/api/users/:id',requireAuth,requireRole('Administrador'),asyncRoute(async(req,res)=>{
  const id=getId(req.params.id);const data=updateUserSchema.parse(req.body);
  if(id===req.currentUser!.id && !data.active){res.status(400).json({error:'No podés desactivar tu propia cuenta'});return;}
  const {rows}=await pool.query(`UPDATE users SET active=$1 WHERE id=$2 RETURNING ${userFields}`,[data.active,id]);
  if(!rows.length){res.status(404).json({error:'Usuario no encontrado'});return;}
  if(!data.active)await revokeUserSessions(id);
  res.json({user:rows[0]});
}));

app.get('/api/tickets',requireAuth,asyncRoute(async(req,res)=>{
  const parsed=z.object({status:z.enum(states).optional(),search:z.string().max(120).optional()}).safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:'Filtros inválidos'});return;}
  const filters:string[]=[];const values:unknown[]=[];
  if(req.currentUser!.role==='Solicitante'){
    values.push(req.currentUser!.email);filters.push(`requester_email=$${values.length}`);
  }
  if(parsed.data.status){values.push(parsed.data.status);filters.push(`status=$${values.length}`);}
  if(parsed.data.search){values.push(`%${parsed.data.search}%`);filters.push(`(title ILIKE $${values.length} OR requester ILIKE $${values.length})`);}
  const where=filters.length?' WHERE '+filters.join(' AND '):'';
  const {rows}=await pool.query(`SELECT ${ticketFields} FROM tickets${where} ORDER BY created_at DESC,id DESC LIMIT 200`,values);
  res.json({data:rows,limit:200});
}));
app.get('/api/tickets/:id',requireAuth,asyncRoute(async(req,res)=>{
  const id=getId(req.params.id);
  const requester=req.currentUser!.role==='Solicitante';
  const {rows}=await pool.query(`SELECT ${ticketFields} FROM tickets WHERE id=$1${requester?' AND requester_email=$2':''}`,
    requester?[id,req.currentUser!.email]:[id]);
  if(!rows.length){res.status(404).json({error:'Ticket no encontrado'});return;}
  res.json({data:rows[0]});
}));
app.post('/api/tickets',requireAuth,asyncRoute(async(req,res)=>{
  const data=ticketCreate.parse(req.body);const self=req.currentUser!;
  const requester=self.role==='Solicitante'?self.name:data.requester;
  const requesterEmail=self.role==='Solicitante'?self.email:data.requesterEmail??null;
  const assignee=self.role==='Solicitante'?'Sin asignar':data.assignee;
  const priority=self.role==='Solicitante'?'Media':data.priority;
  const status=self.role==='Solicitante'?'Registrado':data.status;
  const {rows}=await pool.query(`INSERT INTO tickets(title,description,type,priority,status,requester,requester_email,assignee,comments,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,$9) RETURNING ${ticketFields}`,
    [data.title,data.description,data.type,priority,status,requester,requesterEmail,assignee,data.source]);
  res.status(201).json({data:rows[0]});
}));
app.patch('/api/tickets/:id',requireAuth,requireRole(...STAFF),asyncRoute(async(req,res)=>{
  const id=getId(req.params.id);const data=ticketPatch.parse(req.body);
  const entries=Object.entries(data);
  const updates=entries.map(([key],i)=>`${key}=$${i+1}`);
  const values:unknown[]=entries.map(([,value])=>value);values.push(id);
  const {rows}=await pool.query(`UPDATE tickets SET ${updates.join(',')},updated_at=now()
    WHERE id=$${values.length} RETURNING ${ticketFields}`,values);
  if(!rows.length){res.status(404).json({error:'Ticket no encontrado'});return;}
  res.json({data:rows[0]});
}));
app.post('/api/tickets/:id/comments',requireAuth,asyncRoute(async(req,res)=>{
  const id=getId(req.params.id);const input=commentInput.parse(req.body);const self=req.currentUser!;
  const comment={author:self.name,date:new Date().toISOString(),text:input.text};
  const {rows}=await pool.query(`UPDATE tickets SET comments=comments||$1::jsonb,updated_at=now()
    WHERE id=$2 AND jsonb_array_length(comments)<100${self.role==='Solicitante'?' AND requester_email=$3':''}
    RETURNING ${ticketFields}`,[JSON.stringify([comment]),id,...(self.role==='Solicitante'?[self.email]:[])]);
  if(!rows.length){res.status(404).json({error:'Ticket no encontrado, sin acceso o límite de comentarios alcanzado'});return;}
  res.status(201).json({data:rows[0]});
}));
registerV23Routes(app);
app.use((_req,res)=>res.status(404).json({error:'Ruta no encontrada'}));
const errors:ErrorRequestHandler=(err:unknown,_req,res,_next)=>{
  if(err instanceof ZodError){res.status(400).json({error:'Datos inválidos',details:err.issues.map(i=>({field:i.path.join('.'),message:i.message}))});return;}
  if(err instanceof SyntaxError && 'body' in err){res.status(400).json({error:'JSON inválido'});return;}
  if(err&&typeof err==='object'&&'code'in err&&(err as {code:string}).code==='23505'){
    res.status(409).json({error:'Ya existe un usuario con ese correo o un activo con ese número de serie'});return;
  }
  if(err&&typeof err==='object'&&'code'in err&&(err as {code:string}).code==='23503'){
    res.status(400).json({error:'El ticket relacionado no existe'});return;
  }
  console.error('NEXODESK API:',err);res.status(500).json({error:'Error interno del servidor'});
};
app.use(errors);
const host=process.env.HOST??'127.0.0.1';const port=Number(process.env.PORT??3001);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Puerto inválido');
const server=app.listen(port,host,()=>console.log(`NEXODESK API V2.3 en http://${host}:${port}`));
process.on('SIGINT',()=>server.close(()=>{void pool.end().then(()=>process.exit(0));}));
