# NEXODESK V2.4 — Auditoría, actividad y notas internas

## Alcance

La actualización continúa sobre `main` con V2.3.1 integrado. Conserva el Portal
del Solicitante, los comentarios públicos JSONB y los módulos Assets y Triage.
No incorpora SLA, notificaciones, Pulse ni Intelligence.

El personal IT dispone de una sección **Actividad** en la ficha del ticket y
un formulario separado para notas internas. El Solicitante conserva su Portal
y no recibe los nuevos registros administrativos.

## Arquitectura y fuentes de información

La actividad reúne eventos propios del ticket, comentarios públicos existentes,
notas internas y eventos de Triage. Cada fuente mantiene su registro original:
los diagnósticos y transferencias de Triage no se copian a una segunda bitácora.
Las notas tampoco se agregan al arreglo de comentarios públicos.

Se registra una creación y un evento por operación con cambios efectivos.
Un PATCH sin cambios no produce una nueva entrada. Cierre y reapertura tienen
tipos específicos; sus valores anterior y nuevo se incluyen en la misma
entrada, junto con otros campos modificados en esa operación. Los cambios de
prioridad o responsable causados por Triage sí se auditan como cambios del
ticket, mientras que diagnóstico y transferencia mantienen su registro único
en `triage_events`.

Las operaciones que modifican tickets y sus eventos se ejecutan en una misma
transacción. Los valores anteriores se obtienen de la fila bloqueada en el
servidor. Las validaciones del backend y la sesión autenticada determinan el
autor; la base genera la fecha de los nuevos eventos. El cliente no envía
identidad ni fecha de auditoría.

Los eventos solo incluyen campos de negocio explícitamente seleccionados.
No se serializan el objeto de petición, cabeceras, cookies, tokens ni hashes
de contraseñas en la auditoría.

La lectura utiliza una transacción de solo lectura con snapshot repetible.
El orden es ascendente por fecha UTC con microsegundos; los empates se resuelven
por fuente (`ticket`, `triage`, `comment`, `note`) e ID numérico, sin depender
del orden de llegada de consultas. Las fechas no normalizables van al final,
manteniendo el orden original de los comentarios.

El renderer `js/ticket-activity.js` se monta únicamente en la ficha IT.
`css/ticket-activity.css` encapsula las superficies oscuras y estados de foco,
hover y disabled. Los comentarios API aparecen una sola vez, en Actividad;
el formulario público permanece separado del formulario de nota interna.
Una respuesta asincrónica no puede reabrir una ficha cerrada ni sustituir otra.

## Migración incremental

`backend/sql/005_ticket_activity.sql` amplía una instalación con 001–004.
No elimina ni recrea las tablas existentes. Las notas internas y los eventos
de ticket tienen claves foráneas a tickets y usuarios, y los índices permiten
consultar por ticket, fecha e identificador.

| Componente | Columnas y relaciones añadidas |
| --- | --- |
| `ticket_events` | `id bigint` PK por secuencia, `ticket_id bigint` FK, `kind varchar(24)`, `actor_id bigint` FK nullable, `actor_name varchar(120)` nullable, `occurred_at timestamptz`, `changes jsonb`, `context jsonb` |
| `ticket_internal_notes` | `id bigint` PK por secuencia, `ticket_id bigint` FK, `author_id bigint` FK nullable, `author_name varchar(120)`, `content text`, `created_at timestamptz` |
| `triage_events` existente | `changes jsonb` con valor inicial `{}`, `actor_name varchar(120)` nullable e índice `(ticket_id,created_at,id)` |

Las FK de ticket de las tablas nuevas usan `ON DELETE RESTRICT`; sus FK de
usuario usan `ON DELETE SET NULL` y conservan la instantánea del nombre.
Las fechas nuevas se generan con `clock_timestamp()` en PostgreSQL, después
de adquirir el bloqueo del ticket cuando corresponde. Los campos JSONB exigen
objetos. Las notas exigen contenido y longitud máxima de 5000 caracteres,
validada también con `trim` en la API. Un índice único parcial impide dos
eventos `created` para el mismo ticket. La migración puede repetirse sin
duplicar el backfill ni borrar datos.

Los tickets anteriores a V2.4 conservan su `created_at`. Su representación de
creación histórica tiene autor desconocido; el solicitante no se interpreta
como autor de una operación cuya sesión original no fue registrada. No se
reconstruyen cambios de estado, prioridades o diagnósticos anteriores que no
estén documentados. Los eventos existentes de Triage se consultan directamente.

Los comentarios históricos con fecha ambigua no reciben una fecha inventada:
se conserva el texto de la fecha y se distinguen de los eventos fechados.

## Permisos

Administrador, Coordinador y Técnicos L1–L3 acceden a la actividad y a las notas
internas. Los endpoints nuevos usan `requireAuth` y `requireRole(...STAFF)`.
La ausencia de sesión produce 401; un Solicitante autenticado recibe 403,
incluyendo para sus propios tickets. No hay endpoints para editar auditoría.

Las consultas públicas mantienen los contratos reducidos de V2.3.1 y la
pertenencia comprobada en SQL. Ningún nuevo dato interno se agrega a las
respuestas del Portal o a sus comentarios.

| Endpoint nuevo | Entrada y respuesta | Permiso |
| --- | --- | --- |
| `GET /api/tickets/:id/activity` | `{data:[...]}` con ID de fuente, tipo, autor, fecha, cambios, texto y contexto | IT |
| `GET /api/tickets/:id/notes` | `{data:[...]}` con notas ordenadas por fecha e ID | IT |
| `POST /api/tickets/:id/notes` | Solo `{content:string}`; respuesta 201 `{data:nota}` | IT |

Los campos extra de autor o fecha son rechazados con 400. Un ticket inexistente
produce 404 para personal IT; la comprobación de rol sucede antes de consultar
su existencia. No se implementan edición ni eliminación de notas o eventos.
Las altas de Portal y tickets conservan sus contratos anteriores. Los nuevos
comentarios JSONB incorporan `authorId` obtenido de la sesión para la actividad
IT; la proyección pública conserva exclusivamente `author`, `date` y `text`.
Los comentarios anteriores no se transforman ni se vinculan a usuarios por
coincidencia de nombres.

## Aplicar en una base de prueba

Primero ejecutar sobre una base PostgreSQL separada que ya tenga 001–004,
usando una conexión de prueba provista por entorno:

```sh
cd backend
psql "$NEXODESK_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/005_ticket_activity.sql
```

El migrador `npm run db:migrate` también incluye la migración 005; su conexión
se obtiene de `DATABASE_URL`. No debe ejecutarse en una base personal o de
producción durante la validación. Esta tarea únicamente utiliza una instancia
aislada de pruebas. No modifica documentos académicos Word.

## Pruebas y límites

La validación utiliza PostgreSQL **17.12** en una instancia aislada con base
`nexodesk_test_v24`, cuentas generadas en memoria y Chromium. No utiliza la
conexión de la base personal ni escribe credenciales en archivos versionados.

| Comando ejecutado | Resultado |
| --- | --- |
| `node --experimental-strip-types --test tests/*.test.cjs` | 16 pruebas aprobadas |
| `npm test --prefix backend` | 3 pruebas de contraseñas aprobadas |
| `python -m unittest discover -s tests -p 'test_*.py' -v` con `NEXODESK_TEST_DATABASE_URL` | 16 pruebas aprobadas: 1 de módulos compartidos, 6 de Portal V2.3.1 y 9 de actividad V2.4 |
| `node --check js/app.js` y `node --check js/ticket-activity.js` | Sintaxis válida |
| `git diff --check` | Sin errores |
| `npm run check --prefix backend` | Mantiene exactamente 3 errores TypeScript preexistentes |

Las nueve pruebas nuevas están en `tests/test_ticket_activity.py`. Incluyen:

- Creación IT y Portal con auditoría, actor de sesión y fecha del servidor.
- PATCH con valores anteriores/nuevos, prioridad, responsable e información;
  cierre, reapertura y actualización sin cambios sin eventos duplicados.
- Notas por todos los roles IT, rechazo 401/403 al Solicitante y anónimo,
  campos falsificados rechazados, persistencia y comentarios públicos intactos.
- Triage con diagnóstico, prueba, transferencia y auditoría de cambios reales
  del ticket, sin copiar sus eventos a la tabla nueva.
- Orden cronológico, empates y fechas históricas no interpretables.
- Aplicación de 005 dos veces sobre un esquema fresco 001–004 con usuarios,
  tickets, activos y Triage previamente cargados: se comparan los registros
  completos antes/después, sin pérdida ni cambios de fechas.
- Fallos inyectados en la escritura de auditoría y notas. Se comprueba que no
  queden tickets, modificaciones, diagnósticos, pruebas o eventos parciales.
  Los triggers de prueba solo existen temporalmente en la base aislada.
- Navegador con nota, recarga, exclusión del Portal del Solicitante, contraste
  de al menos 4,5:1 en los elementos medidos, foco de teclado y ancho de 390 y
  1440 px sin desbordamiento de página con la ficha abierta.
- Resultado incierto de POST y lectura fallida después de POST confirmado:
  no se reenvía automáticamente una nota ni se pierde el borrador pendiente.

La suite anterior también comprueba login y persistencia tras cerrar/reabrir
sesiones, funciones de técnicos/administrador y Demo Local sin peticiones API.
No se detectaron excepciones JavaScript en los recorridos comprobados. Se
capturó la ficha IT en escritorio y móvil fuera del checkout, utilizando
`NEXODESK_SCREENSHOTS`. No se versionan capturas, bases ni archivos temporales.

Para repetir la integración, instalar dependencias del backend y
`tests/requirements-browser.txt`, disponer de Chromium y proporcionar
`NEXODESK_TEST_DATABASE_URL` con una base exclusiva cuyo nombre comience por
`nexodesk_test_`. El runner rechaza nombres diferentes y un puerto 3001 ocupado;
inicia su propia API y frontend de prueba. Sin esa variable las pruebas de
PostgreSQL se omiten explícitamente, y no debe interpretarse como validación
de persistencia. Las pruebas agregan fixtures sin truncar tablas.

Los tres errores TypeScript siguen en `src/password.test.ts:3` (TS5097 por la
importación `.ts`) y `src/password.ts:15` y `:25` (TS2554 por el tipado de
`promisify(scrypt)`). Se reprodujeron sobre una copia temporal de `origin/main`
con las mismas dependencias. No se modificaron esos archivos ni se detectaron
nuevos errores en los componentes V2.4.

Implementado: auditoría de operaciones de la API, actividad IT y notas internas
persistidas, junto con el Portal V2.3.1 y comentarios públicos compatibles.
Demo conserva sus comentarios y operaciones locales; no consulta endpoints
privados ni ofrece una auditoría verificada o notas internas simuladas.

Pendiente: paginación de historiales grandes. El endpoint actual devuelve el
historial completo, sin truncarlo silenciosamente a los 100 eventos de la
vista original de Triage. El esquema no ofrece una prueba criptográfica de
inalterabilidad ni impide al propietario de PostgreSQL modificar registros
directamente con SQL; la API sí evita su edición y la falsificación de actor
y fecha. Las escrituras SQL realizadas fuera de la API no generan auditoría
automática. Los documentos académicos y la base personal no fueron alterados.
