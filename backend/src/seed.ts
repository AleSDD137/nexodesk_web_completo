import { pool } from './db.js';
const users = [
 ['A. Sebastián Díaz','sebastian@nexodesk.demo','Técnico'],
 ['C. Vargas','vargas@nexodesk.demo','Técnico'],
 ['M. Fernández','fernandez@nexodesk.demo','Coordinador']
];
const tickets = [
 [10301,'Falla de acceso al sistema ERP','El usuario no puede iniciar sesión en el sistema ERP.','Incidente','Alta','Registrado','María López','A. Sebastián Díaz'],
 [10292,'Instalación de software de diseño','Instalar y validar el software solicitado.','Requerimiento','Media','En revisión','Juan Pérez','C. Vargas'],
 [10294,'Instalación de software de diseño','La aplicación presenta errores al iniciar.','Incidente','Alta','En atención','Lucía Torres','C. Vargas'],
 [10305,'Instalación de software de diseño','Pendiente de confirmación por parte del usuario.','Requerimiento','Media','Validación','Pedro Gómez','C. Vargas']
];
const client = await pool.connect();
try {
 await client.query('BEGIN');
 for (const u of users) await client.query('INSERT INTO users(name,email,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',u);
 for (const t of tickets) await client.query(`INSERT INTO tickets(id,title,description,type,priority,status,requester,assignee)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,t);
 await client.query("SELECT setval(pg_get_serial_sequence('tickets','id'), GREATEST(COALESCE((SELECT MAX(id) FROM tickets), 1), 1), true)");
 await client.query('COMMIT');console.log('Datos demo agregados (sin duplicar).');
} catch(err) { await client.query('ROLLBACK');console.error(err);process.exitCode=1; }
finally {client.release(); await pool.end();}
