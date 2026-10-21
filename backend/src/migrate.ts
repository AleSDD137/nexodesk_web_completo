import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
const files = ['001_init.sql','002_frontend_compat.sql','003_auth.sql','004_assets_triage_portal.sql'];
try {
  for (const name of files) {
    const file=fileURLToPath(new URL('../sql/'+name,import.meta.url));
    await pool.query(await readFile(file,'utf8'));
    console.log('Migración aplicada:',name);
  }
  console.log('Tablas creadas o existentes.');
} catch (err) {
  console.error('Error de migración:', err);
  process.exitCode = 1;
} finally { await pool.end(); }
