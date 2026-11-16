# NEXODESK V2.7 — SLA y automatizaciones controladas

## Implementado

Se añade seguimiento SLA persistente con políticas por prioridad, ventanas
laborales configurables, primera respuesta pública del personal IT, resolución,
alertas y propuestas de escalamiento. El panel SLA comparte exactamente el mismo
renderizador en Demo y API; cambia únicamente el adaptador de datos.

No se modifica la prioridad, responsable, estado ni nivel de Triage mediante las
reglas. El escalamiento es una **propuesta de alerta**, que debe decidir una
persona mediante los controles ya autorizados de Triage. No se envían correos.

## Calendarios y cálculo

Cada política contiene zona horaria IANA, días de semana (0 domingo–6 sábado),
horario local de inicio/fin y objetivos en minutos laborales. Valores iniciales:

| Prioridad | Primera respuesta | Resolución |
| --- | ---: | ---: |
| Crítica | 30 min | 240 min |
| Alta | 60 min | 480 min |
| Media | 240 min | 1080 min |
| Baja | 480 min | 2160 min |

Calendario inicial: lunes a viernes, 09:00–18:00,
`America/Argentina/Buenos_Aires`. No se asume servicio 24 horas; para configurarlo,
seleccionar los siete días, inicio 0 y fin 1440. Los minutos de advertencia son
**minutos de reloj** antes del vencimiento, no duración laboral.

El reloj recorre minutos UTC y comprueba su pertenencia a la ventana local con
`Intl.DateTimeFormat`; los minutos repetidos o ausentes al cambiar horario de
verano se contabilizan por tiempo real, sin adivinar offsets. Si el inicio tiene
segundos, se redondea hacia el próximo minuto: nunca se acorta el objetivo. La
función pura tiene límite anual y cache acotada; las políticas admiten máximo
10080 minutos y objetivos que quepan en cuatro semanas del calendario elegido.
La ventana diaria debe durar al menos una hora. Las pruebas cubren fin de semana,
servicio continuo y ambas transiciones DST de Nueva York.

Se conserva una **instantánea inmutable de la política** por ticket, incluyendo
su prioridad y fecha de configuración cuando estén documentadas. Cambiar la
política o la prioridad actual del ticket no reescribe vencimientos anteriores.
La interfaz diferencia la prioridad actual de la política aplicada. No se
contemplan todavía feriados, turnos partidos, pausas por estado ni calendarios
individuales; requieren una ampliación explícita del modelo.

## Hitos verificables y compatibilidad

- Tickets nuevos: inscripción en la misma transacción de creación administrativa
  o del Portal, desde `tickets.created_at` generado por el servidor.
- Primera respuesta: primer **comentario público de personal IT** posterior a la
  inscripción. Comentarios del Solicitante y notas internas no la registran.
- Resolución: cambio real a Cerrado, incluyendo una creación ya cerrada. Al
  reabrir se conserva la primera respuesta y los vencimientos; se borra la fecha
  de resolución actual y se incrementa el ciclo de alertas. El historial original
  de cierres/reaperturas continúa en `ticket_events`.
- Si una escritura de hitos falla, ticket, comentario y auditoría se revierten
  con la misma transacción. La fecha/actor no se aceptan desde parámetros del
  cliente.
- Tickets históricos sin seguimiento: una comprobación explícita los inscribe
  **desde ese momento**, sin inventar primeras respuestas ni cumplimiento previo.
  No se reutilizan fechas locales ambiguas como evidencia. La cobertura de
  reportes distingue tickets inscritos y no inscritos.
- Políticas deshabilitadas: no inscriben nuevos tickets para esa prioridad; las
  instantáneas ya asignadas continúan siendo válidas.

## Alertas y automatización

`POST /sla/check` procesa hasta 100 tickets abiertos, ordenados por ID, usando
`after` y `nextAfter`. Se bloquea cada lote dentro de una transacción. Cada alerta
es única por ticket, ciclo y tipo: repetir comprobaciones no duplica alertas.
Tipos: advertencia/incumplimiento de primera respuesta, advertencia/incumplimiento
de resolución y propuesta de escalamiento al nivel configurado (L2 o L3).

Reconocer una alerta conserva el primer usuario y fecha; repetir la operación no
reescribe su historia. Reconocer no altera el SLA ni ejecuta la propuesta.

El botón de la interfaz realiza hasta 20 peticiones secuenciales de 100 registros
para evitar una petición ilimitada. Si faltan registros, muestra la necesidad de
continuar y conserva el cursor. No hay sondeo constante del navegador.

Trabajador opcional del backend:

```text
SLA_CHECK_INTERVAL_SECONDS=60
```

Por defecto vale `0` (desactivado). Se admiten 60–86400 segundos. Procesa un lote
por intervalo, conserva el cursor y evita ejecuciones solapadas del mismo proceso.
Varias instancias mantienen la idempotencia mediante restricciones SQL y bloqueos.
El temporizador se cancela al cerrar el servidor y no impide la salida de Node.
Sin trabajador activo, las alertas se registran al pulsar Comprobar; los indicadores
de vencimiento se calculan al consultar el panel.

## PostgreSQL — migración 008

Migración incremental transaccional `008_sla.sql`, repetible:

- `sla_policies`: PK prioridad, objetivos, calendario y configuración de alertas;
  FK opcional `updated_by → users`. La carga inicial usa ON CONFLICT DO NOTHING,
  por lo que volver a migrar conserva las políticas editadas.
- `ticket_sla`: PK/FK `ticket_id → tickets`, JSONB de política, inicio,
  vencimientos, hitos y ciclo. Índice por vencimiento de resolución y ticket.
- `sla_alerts`: PK propia, FK `ticket_id → ticket_sla`, tipo, ciclo, nivel
  propuesto y fechas; FK opcional del usuario que reconoce; unicidad compuesta e
  índice cronológico.

No se borran ni reconstruyen tablas anteriores. No se crean actividades
históricas ni se modifica Triage para alimentar este módulo. Aplicar junto con las
migraciones 001–007 mediante `npm run db:migrate`, primero en una base aislada y,
para actualizar un entorno propio, con respaldo previo y conexión verificada.

## API y permisos

Todas las rutas están bajo `/api`, con sesión por cookie y defensa CSRF existente.
Solicitante: 403. Sin sesión: 401. Solo Administrador/Coordinador pueden configurar
políticas; Técnicos L1–L3 pueden consultar, comprobar y reconocer alertas.

| Método y ruta | Contrato |
| --- | --- |
| GET `/sla/policies` | Políticas actuales |
| PUT `/sla/policies/:priority` | Objeto estricto con responseMinutes, resolutionMinutes, timezone, weekdays, startMinute, endMinute, warningMinutes, escalationEnabled, escalationLevel y enabled |
| GET `/sla/tickets` | priority, status (`pending`, `overdue`, `met`, `breached`), limit 1–100 (20), offset; datos y total real de inscritos |
| GET `/sla/alerts` | limit 1–100 (30), offset; historial ordenado por fecha/ID descendentes |
| POST `/sla/check` | `{after?:number,limit?:number}`; processed, enrolled, alertsCreated, nextAfter |
| POST `/sla/alerts/:id/acknowledge` | `{}`; reconocimiento idempotente con identidad/fecha del servidor |

`overdue` significa un hito aún pendiente y vencido; `breached`, un hito
realizado fuera de plazo sin otro hito pendiente vencido; `met`, ambos hitos
cumplidos; `pending`, casos restantes. Cada fila además presenta el estado
individual de respuesta/resolución para evitar ambigüedades. La tabla representa
todos los inscritos del filtro mediante paginación; no presenta la página como
un total global.

## Demo, interfaz y accesibilidad

Datos locales exclusivos en `nexodesk-demo-sla-v27`; nunca se usan en un error de
API. La inscripción es explícita y visible como Demo, con el mismo calendario.
Solo se registran hitos futuros observados después de una escritura local
exitosa: comentario público, cierre y reapertura. No se infieren hitos de las
fechas antiguas de comentarios. Es una demostración del navegador, sin identidad
ni hora certificadas por un servidor. Los cambios de estado, título y prioridad
se sincronizan con el contexto, preservando la instantánea original.

La vista tiene estados pending/ready/error, filtros, controles deshabilitados
mientras carga, foco visible, contraste oscuro y tabla con desplazamiento interno.
Los horarios mostrados respetan la zona del navegador; el calendario aplicado se
muestra en la fila y no se confunde con esa presentación.

## Archivos y pruebas

- Backend: `sla.ts`, `sla-clock.ts`, `sla.test.ts`, SQL 008.
- Frontend: `js/sla-data.js`, `js/sla-ui.js`, `css/sla.css`.
- Integración coordinada en server, rutas del Portal, navegación, migrador y hooks
  del frontend; no sustituye interfaces existentes.
- Pruebas: `tests/test_sla.py`, `tests/sla-data.test.cjs` y el recorrido SLA en
  `tests/test_v29_browser.py`.

Ejecutado por Codex durante esta fase:

- TypeScript `npm run check`: aprobado.
- 4 pruebas del reloj: aprobadas.
- 4 pruebas de adaptadores Demo/API: aprobadas.
- 7 pruebas API contra PostgreSQL aislado: aprobadas; incluyen roles, validación,
  snapshots, hitos, conservación al repetir 008, reconocimiento/idempotencia,
  ausencia de automatizaciones de tickets y reversión ante error SQL inyectado.
- Recorrido Chromium del panel realizado por la suite integrada: aprobado en
  esta fase, con creación de alertas, reconocimiento/reload, idempotencia,
  contraste y anchos 390/768/1440. La suite final se registra en el plan integrado.

No se accedió a la base personal. La validación del despliegue del estudiante
queda para la única ronda manual final del bloque V2.6–V2.9.
