import 'dotenv/config';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL en backend/.env');
export const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
