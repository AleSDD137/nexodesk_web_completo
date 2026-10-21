/** Crear la PRIMERA cuenta administradora, desde la terminal local (sin credenciales fijas en código). */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { hashPassword } from './auth.js';

const [name, emailArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!name?.trim() || name.length > 120 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  console.error('Uso: npm.cmd run auth:bootstrap -- "Nombre Apellido" "admin@ejemplo.com"');
  process.exit(1);
}
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Evita dos ejecuciones concurrentes y el recreado de otro superusuario.
  await client.query('SELECT pg_advisory_xact_lock(422018)');
  const existing = await client.query("SELECT id FROM users WHERE role='Administrador' AND password_hash IS NOT NULL LIMIT 1");
  if (existing.rowCount) { throw Error('Ya existe un administrador con contraseña. Usá esa cuenta para crear otros usuarios.'); }
  const temporaryPassword = randomBytes(24).toString('base64url');
  const hashed = await hashPassword(temporaryPassword);
  const { rows } = await client.query(`INSERT INTO users(name,email,role,active,password_hash,support_level)
    VALUES($1,$2,'Administrador',true,$3,NULL)
    RETURNING id`,[name.trim(),email,hashed]);
  await client.query('COMMIT');
  console.log(`\nAdministrador creado: ${email} (ID ${rows[0].id})`);
  console.log(`CONTRASEÑA TEMPORAL (mostrada solo una vez): ${temporaryPassword}`);
  console.log('Ingresá con esta contraseña en modo API y cambiala inmediatamente desde Configuración.');
  console.log('No compartas capturas de esta terminal ni guardes la contraseña dentro del proyecto.');
} catch (err) {
  await client.query('ROLLBACK'); console.error(err instanceof Error ? err.message : err); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
