# NEXODESK V2.9 — Reportes y métricas

## Implementación y arquitectura

El centro de Reportes utiliza un renderizador compartido (`NexoReports.render`)
con adaptadores separados. API consulta agregados PostgreSQL, sin descargar la
página de 200 tickets para calcular supuestos totales. Demo calcula únicamente
sobre sus registros locales y conserva los datos desconocidos como tales.
Una falla de API se presenta como error; no activa Demo ni modifica localStorage.

El backend usa consultas parametrizadas dentro de una transacción `REPEATABLE
READ, READ ONLY` para que los indicadores de una respuesta compartan una
instantánea. No se agregan tablas ni se duplican eventos para alimentar reportes.
Se reutilizan tickets, Triage, auditoría, comentarios públicos, Assets,
Relaciones IT y las mediciones SLA incorporadas en V2.7.

## Permisos y endpoints

Solo Administrador y Coordinador pueden consultar o exportar reportes reales.
Técnicos y Solicitantes reciben HTTP 403; sin sesión, 401. Los técnicos conservan
Pulse y el panel SLA como herramientas operativas.

| Método y ruta | Respuesta |
| --- | --- |
| GET `/api/reports/summary` | `{data: ReportData}` con indicadores y alcance |
| GET `/api/reports/export` | JSON `{filename,mime,content}` para descargar CSV desde el adaptador autenticado |
| GET `/api/reports/export.csv` | CSV directo con Content-Disposition attachment |

Todos admiten `from`, `to`, `assignee`, `category`, `priority`, `status`.
Las fechas son días UTC inclusivos, validados como fechas reales. `assignee`
es coincidencia exacta del responsable textual actual; no se infieren usuarios.
Categoría, prioridad y estado también corresponden a la clasificación actual.
Sin clasificación Triage, se usa `Sin clasificar`. Filtros inválidos o propiedades
desconocidas devuelven 400. No existen endpoints de escritura de reportes.

## Definición de cada KPI

La interfaz y el CSV distinguen cohortes. Aplicar un filtro no reconstruye la
clasificación histórica de un ticket.

| Indicador | Cálculo y alcance |
| --- | --- |
| Creados | Todos los tickets cuya creación cae dentro del período y coinciden con los filtros actuales |
| Abiertos | Tickets de esa cohorte cuyo estado actual no es Cerrado |
| Pendientes | Cohorte con estado Registrado, En revisión o Validación |
| Cerrados actuales | Cohorte cuyo estado actual es Cerrado; no implica que cerró dentro del período |
| Resueltos en el período | Tickets distintos con un evento `closed` documentado dentro del período, independientemente de cuándo se crearon o de su reapertura posterior |
| Eventos de cierre | Cantidad de eventos `closed` del período; puede superar tickets distintos por ciclos de reapertura |
| Primera respuesta media | Promedio de minutos calendario entre `ticket_sla.started_at` y `first_response_at` documentada, sobre la cohorte de creación; incluye número de mediciones, excluye desconocidos |
| Resolución media | Promedio de minutos calendario desde creación hasta el último `closed` documentado de tickets actualmente cerrados de la cohorte; excluye cerrados sin fecha fiable |
| Distribución por prioridad/estado/categoría | Recuento completo de la cohorte, usando valores actuales |
| Responsables actuales | Agrupación por `tickets.assignee` textual, con abiertos y cerrados; no mide intervenciones técnicas |
| Tickets con intervenciones documentadas | Tickets distintos por ID de usuario IT que figura como actor de auditoría, Triage o comentario público con fecha válida dentro del período; utiliza todos los tickets que cumplen los filtros de clasificación, no solo creados en el período |
| Nivel L1/L2/L3 actual | Nivel actual del expediente de cada ticket de la cohorte; sin expediente, L1 inicial |
| Transferencias | Eventos Triage de transferencia ocurridos en el período, para tickets con la clasificación filtrada |
| Incidentes recurrentes | Grupos de tickets tipo Incidente con el mismo título tras normalizar espacios y mayúsculas; coincidencia textual para investigación, sin afirmar igual equipo ni causa |
| Tendencias | Tickets creados y eventos de auditoría/cierre por día UTC; se explicita que un ticket puede tener varios cierres |
| Inventario | Total global de activos, vinculados, estados y ubicaciones; los filtros de tickets no se aplican al inventario |

Las fechas visibles usan la zona horaria del navegador; agrupaciones y filtros
temporales usan UTC. La respuesta informa `generatedAt` generado por el servidor.
Los tiempos promedio son calendario, **no** minutos laborales; el cumplimiento
SLA se calcula mediante sus deadlines ya resueltos con calendario laboral.

En tickets nuevos, el inicio SLA coincide con la creación. La inscripción
explícita de un ticket previo comienza en ese momento y no inventa una primera
respuesta anterior. Por eso el promedio de primera respuesta expresa tiempo
desde inscripción y publica su número de mediciones. Un dato ausente es `null`,
nunca cero por conveniencia.

Para intervenciones se exige un ID que corresponda actualmente a una cuenta IT
registrada; nombres coincidentes y comentarios del Solicitante no cuentan.
Se omiten comentarios legados sin ID o fecha UTC válida. Fechas malformadas o
imposibles no interrumpen la consulta. No se leen ni se exportan contenidos de
notas internas ni cuerpos de comentarios. Un usuario eliminado o cuyo rol ya no
es IT queda fuera de esta agrupación: el esquema previo no conserva su rol
histórico y no se infiere. La carga actual permanece disponible como otro KPI.

## SLA y cobertura

`covered`/`uncovered` distinguen tickets con y sin snapshot SLA. Por primera
respuesta y resolución se muestran:

- Finalizados documentados y cuántos cumplieron el deadline.
- Pendientes aún dentro del plazo.
- Incumplidos, incluyendo pendientes vencidos y finalizados fuera de plazo.

No se presenta un pendiente como cumplido. Los valores describen el ciclo SLA
actual: una reapertura conserva las reglas/deadlines conforme V2.7 y limpia el
milestone de resolución. No se afirma reconstruir todos los ciclos anteriores.

## Límites y presentación

- Distribuciones y totales de tickets son globales de su cohorte.
- Responsables e intervenciones: máximo 100 grupos, junto a total de grupos.
- Títulos repetidos: máximo 50 grupos, junto a total.
- Tendencias: últimos 366 días **con actividad**, junto al total de días.
- Ubicaciones: máximo 100 grupos, junto a total.

Estos límites son visibles y también se exportan; los listados limitados no se
presentan como la base completa. Las barras comparan magnitudes de grupos
visibles y siempre incluyen cantidades textuales. Tablas con desplazamiento
interno, controles con foco visible, estados carga/error/vacío y recuperación
al cambiar de vista durante una petición. No se duplica el diseño por origen.

## Exportación

CSV con UTF-8/BOM, todas las celdas entre comillas, comillas internas escapadas,
saltos de línea preservados y prefijo textual para valores que podrían iniciar
fórmulas de hoja de cálculo, incluso con espacios o controles al principio.
El exportador obtiene una instantánea nueva con los mismos filtros y adjunta su
fecha. Exporta **el reporte agregado y sus límites declarados**, no un volcado
de tickets ni una muestra presentada como universo.

El botón Imprimir / guardar PDF usa la impresión del navegador y estilos
locales. No se instaló un generador PDF en el servidor; su disponibilidad final
depende del navegador. No se agregan dependencias externas.

## Demo Local

Misma estructura y controles con fuente local explícita. Fechas de creación
ausentes se incluyen solo sin filtros temporales y su cantidad se informa.
Cierres, intervenciones y tiempos que los registros locales previos no
documentan se muestran como Sin dato o sin intervenciones verificables.
El panel SLA Demo puede ofrecer simulación separada; estos reportes no inventan
un historial de cumplimiento a partir del estado actual.

## Archivos y verificación

- Backend: `backend/src/reports.ts`, `reports-format.ts`, `reports-format.test.ts`.
- Frontend: `js/reports-data.js`, `js/reports-ui.js`, `css/reports.css`.
- Integración de rutas/navegación y CI: coordinada en el commit final del bloque.
- API/SQL: `tests/test_reports_v29.py` (permisos, filtros, cohorte >200, cierres
  múltiples, tiempos conocidos/desconocidos, dos técnicos por ID, comentarios
  ajenos/fechas inválidas y exportación segura).
- Navegador: `tests/test_v29_browser.py` y plan integral del bloque.

Ejecutado durante desarrollo: `npm run check` sin errores y prueba unitaria de
exportación (`node --experimental-strip-types --test
backend/src/reports-format.test.ts`) aprobada. La ejecución PostgreSQL/API y
navegador se registra en `docs/NEXODESK_INTEGRATION_TEST_PLAN.md` al integrar
las fases; no se declara aprobada antes de ejecutarla.

La base personal del estudiante no se inspeccionó ni se modificó. La validación
integral final de su despliegue sigue pendiente de la única ronda manual acordada.
