# NEXODESK V2.9.1 — Búsqueda, SLA y responsive

Base: main `23207d0`, con el bloque V2.6–V2.9 integrado.

## Diagnóstico reproducido

Chromium confirmó que escribir `vpn` reemplazaba el panel SLA. El listener de
`app.js` llamaba a render() por tecla; además solo filtraba la lista de tickets
cargados y no buscaba usuarios ni todos los tickets del servidor.

En SLA, load() deshabilitaba inputs y selects antes de construir FormData.
Los controles disabled se excluyen: prioridad y cumplimiento llegaban vacíos.
La comprobación global ya era idempotente, pero su alcance y el del historial
no estaban claros. No se cambió esa regla ni se agregaron acciones automáticas.

Antes de corregir, a 390 px se observaron anchos de página de 1809 px en Tickets
y 1546 en otros módulos: el grid móvil retenía el ancho intrínseco de navegación,
y las tablas/flujo necesitaban contenedores y columnas adaptables.

## Correcciones y archivos

- `backend/src/search.ts`, registro en `server.ts`: GET `/api/search` con
  `q` (1–120), `type=tickets|users`, `limit` (1–50, default10) y `offset`.
  Retorna `{data,total,limit,offset}` desde una instantánea SQL. Tickets propios
  para Solicitante, todos para IT; usuarios solo Administrador/Coordinador.
  Sin sesión 401, búsqueda de usuarios no autorizada 403. Sin escrituras.
- `js/search-ui.js`, `js/app.js`, `dashboard.html`: panel superpuesto independiente,
  debounce 300ms, paginación, apertura de resultados, foco, carga/error/vacíos,
  descarte de respuestas obsoletas y separación de fuentes. Demo solo usa sus
  datos locales. El placeholder refleja los permisos. Buscar ya no filtra
  implícitamente el Kanban; los resultados aparecen en su panel explícito.
- `js/v22-auth.js`: identificación/foco de la fila del usuario seleccionado.
- `js/sla-ui.js`: captura de filtros antes del bloqueo, conservación por usuario
  y origen, limpieza, alcance visible y mensajes de comprobación global.
  Editor con días por checkbox, zona horaria, horas HH:MM y cancelación.
  00:00 como fin representa 1440 minutos; conserva calendarios existentes y
  sus zonas, incluyendo zonas distintas de las ofrecidas inicialmente.
  Solo Guardar envía datos, convertido al contrato de minutos existente.
- `backend/src/sla.ts`, `js/sla-data.js`: metadato aditivo `coverage.untracked`
  para distinguir tickets sin seguimiento de una lista filtrada vacía.
- `css/corrections.css`: búsqueda absoluta sin desplazar contenido, grid móvil
  acotado, tablas con scroll interno, pasos en una columna móvil, formularios,
  acciones, diálogos y configuración adaptables. No oculta overflow de página
  para disimular defectos ni usa !important.
- `tests/test_v291.py`: API y recorridos Chromium con datos PostgreSQL aislados.

No hay migraciones, seeds destructivos ni cambios en autenticación/permisos
anteriores, prioridades, responsables o políticas al abrir el editor.

## Pruebas y resultados

Resultado final: **108 pruebas aprobadas**, sin omisiones: 20 backend,
23 adaptadores/contratos Node y 65 Python de API/PostgreSQL/Chromium.
`npm run check` terminó sin errores. La ejecución Python final duró 171,286 s
sobre PostgreSQL17 aislado, base nueva `nexodesk_test_v291_final`.
También se repitieron las tres pruebas específicas tras recuperar el entorno
(3/3 aprobadas), incluyendo las respuestas retrasadas deliberadamente.
No se verificó el despliegue personal ni la ejecución remota de Actions.
La prueba específica verifica escritura rápida (una solicitud por tipo), foco,
texto, identidad del panel y scroll, resultados reales, paginación/roles,
respuestas obsoletas, Demo sin HTTP, filtros y políticas recuperadas sin cambios
silenciosos. Se mide scrollWidth <= viewport en 390, 768, 1024 y 1440 para
Tickets, Procesos, Usuarios y Configuración, con capturas fuera del repositorio.

## Actualización local y aceptación

Después de revisar e integrar el PR: guardar cambios locales, `git switch main`,
`git pull --ff-only`, luego desde backend `npm ci`, `npm run check`, `npm start`.
No requiere nuevas migraciones. Conservar .env y PostgreSQL existentes.
Recargar Live Server con Ctrl+F5. Probar búsqueda continua, seleccionar resultados,
filtros SLA, limpiar/actualizar/paginar y guardar/cancelar políticas. Revisar
los cuatro módulos en celular; las tablas se desplazan dentro de su contenedor.

La base personal no se utilizó. Se necesita aceptación en el despliegue del
estudiante; el proveedor IA real no forma parte de esta corrección. La búsqueda
de usuarios mantiene el permiso de administración, no se habilita a técnicos.


### Cómo repetir las verificaciones

Desde backend: `npm run check` y `npm test`. Desde la raíz:
`node --test tests/*.test.cjs`. Para API/navegador, instalar los requisitos de
`tests/requirements-browser.txt`, Chromium y definir
`NEXODESK_TEST_DATABASE_URL` apuntando exclusivamente a una base aislada con
prefijo `nexodesk_test_`; ejecutar
`python -m unittest discover -s tests -p 'test_*.py' -v`.
El puerto 3001 debe estar libre. Capturas opcionales con `NEXODESK_SCREENSHOTS`
fuera del repositorio. No usar la conexión personal para estas pruebas.
