import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { hashPassword, verifyPassword, passwordError, tokenDigest } from './password.js';
import { pool } from './db.js';

export const SESSION_MS = 12 * 60 * 60 * 1000; // 12 horas sin renovación implícita
const COOKIE = 'nx_session';
export const ADMIN = 'Administrador';
export const MANAGERS = ['Administrador', 'Coordinador'] as const;
export const STAFF = ['Administrador', 'Coordinador', 'Técnico'] as const;
export type Role = 'Administrador' | 'Coordinador' | 'Técnico' | 'Solicitante';
export interface AuthUser { id: number; name: string; email: string; role: Role; supportLevel: number | null; }

export { hashPassword, verifyPassword, passwordError, tokenDigest };
export function freshToken(): string { return randomBytes(32).toString('hex'); }

function cookieValue(req: Request): string | null {
  const raw = req.headers.cookie ?? '';
  const cookie = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
  const token = cookie ? cookie.slice(COOKIE.length + 1) : null;
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    path: '/api', maxAge: SESSION_MS
  });
}
export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path:'/api' });
}
export async function issueSession(res: Response, id: number): Promise<void> {
  const token = freshToken();
  await pool.query('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',
    [tokenDigest(token), id, new Date(Date.now() + SESSION_MS)]);
  setSessionCookie(res, token);
}
export async function revokeSession(req: Request): Promise<void> {
  const token = cookieValue(req);
  if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenDigest(token)]);
}
export async function revokeUserSessions(id: number): Promise<void> {
  await pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
}
export async function lookupUser(req: Request): Promise<AuthUser | null> {
  const token = cookieValue(req);
  if (!token) return null;
  const { rows } = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.support_level AS "supportLevel"
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active=true AND u.password_hash IS NOT NULL`, [tokenDigest(token)]);
  return rows[0] ? {...rows[0],id:Number(rows[0].id)} as AuthUser : null;
}
// Extiende Request sin confiar en cabeceras que el cliente pueda falsificar.
declare global { namespace Express { interface Request { currentUser?: AuthUser; } } }
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void lookupUser(req).then(user => {
    if (!user) { res.status(401).json({ error:'Iniciá sesión para continuar.' }); return; }
    req.currentUser = user; next();
  }).catch(next);
}
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser) { res.status(401).json({error:'Sin sesión.'}); return; }
    if (!allowed.includes(req.currentUser.role)) { res.status(403).json({error:'No tenés permisos para esta operación.'}); return; }
    next();
  };
}
