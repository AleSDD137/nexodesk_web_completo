# NEXODESK V2.5 — Pulse y Relaciones IT

## Estado y decisiones

Implementado a partir de `main` V2.4.1 (`4120422`). Antes de esta actualización,
Pulse calculaba indicadores ilustrativos/locales y Relaciones IT construía su
gráfico desde localStorage, incluyendo coincidencias de nombres. La navegación
API ocultaba ambos módulos. Su presencia en Demo no implicaba persistencia SQL.

Ahora cada módulo tiene **un renderizador compartido** y dos adaptadores de
datos. Los adaptadores API usan exclusivamente endpoints autenticados. Los Demo
usan el contexto local y sus claves existentes; una falla HTTP no activa un
fallback ni escribe en localStorage. Intelligence conserva su implementación.

## Pulse

- Totales SQL: abiertos (todo salvo Cerrado), En atención, Validación, Cerrado,
  sin asignar **abiertos** y total. No dependen del límite de 200 del Kanban.
- Distribución completa por estado/prioridad y carga por responsable actual.
  La carga agrupa el texto `tickets.assignee`, con máximo 50 grupos y cantidad
  total de grupos explícita. No representa una asignación formal por usuario
  ni un conteo histórico de intervenciones técnicas.
- Cantidades de expedientes actualmente en L2 y L3.
- Feed original de `ticket_events` y `triage_events`, sin copiar registros.
  Un cambio de varios campos sigue siendo un solo evento. Solo se proyectan
  cambios de estado, prioridad y responsable, niveles, autor, fecha y ticket.
  No se consulta ni transmite contenido de notas internas, diagnósticos o
  instrucciones pendientes en el feed general.
- Botón de actualización, filtros y carga incremental; sin sondeo periódico.

Los filtros `from`/`to` son días UTC inclusivos. Las estadísticas representan
el **estado actual de tickets creados en ese período**, no una reconstrucción
histórica. El feed filtra por **fecha del evento**. La interfaz explica ambas
bases. Las fechas se muestran con la zona horaria del navegador.

Las consultas de resumen usan una instantánea de lectura repetible. El feed
ordena por fecha descendente, fuente y ID; conserva precisión de microsegundos
en el cursor y un corte `asOf`. Cada fuente limita su consulta antes de unir
resultados. El cursor está validado y asociado al filtro, pero no es una
credencial ni una instantánea entre peticiones de todas las tablas.

Demo conserva las fechas documentadas: las desconocidas se identifican como
tales y quedan fuera de filtros temporales, sin inventar autores o fechas.

## Relaciones IT

La vista permite buscar activos por serie, equipo/tipo y ubicación, seleccionar
uno y consultar su gráfico, responsable textual, cuenta vinculada y tickets.
El listado pagina de 20 en 20; los vínculos del activo, de 50 en 50. El gráfico
representa **el activo seleccionado y su página de tickets**, no toda la base.
Las mismas entidades están disponibles mediante controles textuales.

Se pueden buscar tickets por ID/asunto y cuentas activas por ID/nombre. Las
búsquedas del formulario muestran hasta 20 candidatos y piden refinar la
consulta. Los endpoints admiten paginación para resultados adicionales.

Se conserva el vínculo principal `assets.ticket_id`, gestionado desde Assets.
Los vínculos adicionales son muchos a muchos. Se rechazan duplicados con 409;
Relaciones no permite borrar el principal. Si Assets convierte un vínculo
adicional en principal, las lecturas muestran una sola conexión con ambos
indicadores, sin borrar información automáticamente.

La cuenta responsable se elige explícitamente por ID y FK, con validación de
cuenta activa. Quitar esa asociación deja intacto `owner_name`; no se infieren
cuentas por nombres ni por solicitantes de tickets. El gráfico solo presenta
esa cuenta verificada. Las fichas de activos reutilizan el editor existente.
Los tickets fuera de la página inicial de 200 se consultan individualmente
por el endpoint ya existente antes de abrir su ficha.

Las escrituras bloquean el activo dentro de una transacción y emplean consultas
parametrizadas. Ante un resultado incierto de escritura, la interfaz pide
actualizar antes de reintentar. Un error de lectura permanece visible.

## Esquema y migración

`backend/sql/006_relations_pulse.sql`, incremental y transaccional:

| Estructura | Definición |
| --- | --- |
| `assets.owner_user_id` | BIGINT nullable, FK a users, ON DELETE SET NULL |
| `asset_ticket_links.asset_id` | BIGINT NOT NULL, FK assets, ON DELETE CASCADE |
| `asset_ticket_links.ticket_id` | BIGINT NOT NULL, FK tickets, ON DELETE CASCADE |
| `asset_ticket_links.created_by` | BIGINT nullable, FK users, ON DELETE SET NULL |
| `asset_ticket_links.created_at` | TIMESTAMPTZ NOT NULL, default clock_timestamp() |

La PK compuesta `(asset_id,ticket_id)` impide duplicados adicionales. Hay índices
por cuenta responsable, ticket relacionado y fecha/ID de las dos fuentes de
actividad. No se crean tablas de métricas ni se copian vínculos principales.
No se modifican registros históricos. Ver [modelo relacional](modelo-relacional-v2-5.mmd).

El ejecutor existente vuelve a aplicar todos los archivos; 006 usa
`IF NOT EXISTS` y admite repetición. Probar primero en una base separada con
las migraciones 001–005. Para un despliegue, respaldar la base, revisar la URL
del entorno de destino y ejecutar desde `backend`:

```sh
npm ci
npm run db:migrate
npm run check
npm start
```

Configurar DATABASE_URL mediante el mecanismo privado del entorno. No publicar
archivos .env. Esta tarea aplicó migraciones únicamente en PostgreSQL aislado,
no en la base personal ni en producción.

## API y permisos

Todos los endpoints nuevos requieren sesión y rol Administrador, Coordinador
o Técnico (L1–L3). Solicitante recibe 403 y ausencia de sesión, 401. Se conserva
su Portal y la autorización previa de tickets/notas internas.

| Método y ruta bajo `/api` | Contrato |
| --- | --- |
| GET `/pulse/summary` | `from`, `to`; `{data:{totals,byStatus,byPriority,workload,workloadLimit,totalWorkloadGroups,escalated,scope,generatedAt}}` |
| GET `/pulse/activity` | `from`, `to`, `limit` 1–100 (20), `cursor`; `{data,nextCursor,hasMore,generatedAt}` |
| GET `/relations/assets` | `search`, `limit` 1–100 (20), `offset`; `{data,total,limit,offset}` |
| GET `/relations/assets/:id` | `limit` 1–100 (50), `offset`; `{data:{asset,tickets,ownerUser,total,limit,offset}}` |
| GET `/relations/tickets` | `search`, `limit`, `offset`; tickets candidatos y total |
| GET `/relations/users` | `search`, `limit`, `offset`; cuentas activas, sin secretos ni emails |
| GET `/relations/tickets/:id/assets` | `limit`, `offset`; activos relacionados y total |
| POST `/relations/links` | `{assetId,ticketId}`; 201, identidad/fecha del servidor |
| DELETE `/relations/links/:assetId/:ticketId` | Sin campos; elimina solo adicional |
| PUT `/relations/assets/:id/owner` | `{userId:number|null}`; asociación explícita |

Entradas inválidas: 400; entidades inexistentes: 404; duplicado o eliminación
de principal: 409. Los cuerpos de escritura rechazan propiedades adicionales.
Los roles IT autorizados pueden consultar y administrar estos vínculos; no se
amplían los permisos existentes sobre cuentas, tickets, Assets o Triage.

## Archivos

- Backend: nuevos `src/pulse.ts`, `src/relations.ts`, SQL 006; registro de rutas
  en `src/server.ts` y de migración en `src/migrate.ts`.
- Frontend: nuevos `js/pulse-data.js`, `js/pulse-ui.js`,
  `js/relations-data.js`, `css/pulse.css`; vista compartida en `js/v13.js`
  y estilos acotados en `css/v13.css`.
- Integración: `dashboard.html`, `js/v12.js`, `js/v22-auth.js`, `js/app.js`,
  `js/v21-bridge.js`, `js/assets-ui.js` (reutilización de fichas y navegación).
- Pruebas: `tests/test_pulse_relations.py`, inclusión de 006 en el fixture
  `tests/test_requester_portal.py`. Documentación: este archivo y modelo Mermaid.

## Verificación

Comandos reproducibles (la URL de pruebas debe apuntar a una base aislada cuyo
nombre comience con `nexodesk_test_`; el harness rechaza otro nombre):

```sh
cd backend
npm run check
npm test
cd ..
node --test tests/*.test.cjs
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -p 'test_*.py' -v
```

Para Python se requieren Playwright, Chromium y
`NEXODESK_TEST_DATABASE_URL`; capturas opcionales mediante
`NEXODESK_SCREENSHOTS`, apuntando fuera del repositorio. Las credenciales de
fixtures se generan en memoria; no se incluyen archivos temporales ni bases.

Resultado: `npm run check` sin errores; 16 pruebas Node de contratos/adaptadores,
5 de contraseñas y 30 Python de API/PostgreSQL/Chromium aprobadas (51 en total).
PostgreSQL 17.12 temporal, aislado, con datos sintéticos. Las 8 pruebas nuevas
cubren totales mayores a 200 contrastados con SQL, filtros UTC, cursor y
privacidad del feed, vínculos/duplicados/principal, asociación explícita,
401/403 y roles IT, repetición de 006 sobre 001–005 con comparación de datos,
persistencia al recargar/reingresar y recorridos reales API/Demo. Las pruebas
previas de Portal, Triage, Assets, auditoría, privacidad y contraseñas pasaron.

Se comprobaron ambos módulos y orígenes en Chromium a 390, 768 y 1440 px,
con capturas externas al repositorio, contraste de controles/textos y ausencia
de desbordamiento de página. El gráfico mantiene desplazamiento interno.
Se verificó además un error HTTP controlado sin fallback a Demo.

## Límites y próximas versiones

- Validado con PostgreSQL aislado; la base y el despliegue personales requieren
  aplicar la migración y realizar su propia comprobación de aceptación.
- Actualización manual; sin WebSockets ni tareas periódicas.
- Búsquedas ILIKE sin índices de trigramas; evaluar planes y volúmenes reales
  antes de ampliar escala. La carga usa responsables textuales heredados.
- No se formaliza todavía la identidad del responsable de tickets; la FK nueva
  corresponde exclusivamente al responsable del activo.
- No se añadieron SLA, notificaciones, Intelligence avanzado ni automatización
  de inventario. No se cambió el historial ni el almacenamiento de notas.
