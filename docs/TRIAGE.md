# Triage L1–L3: interfaz compartida

La vista de `js/v15.js` es la única interfaz de Triage para Demo Local y API + PostgreSQL. Conserva el diseño oscuro de la demo: estadísticas, bandeja con búsqueda y filtros, expediente, diagnóstico, pruebas, guías, transferencia manual e historial. `css/v15.css` contiene sus estilos; `v23.js` mantiene únicamente las interfaces específicas de Assets y Portal.

## Decisiones de implementación

- `js/triage-data.js` separa los adaptadores `demo` y `api`. Ambos ofrecen `load`, `get`, `save` y `transfer`; la eliminación de pruebas es una capacidad exclusiva de la demo.
- La demo conserva la clave `nexodesk-triage-v15` y el formato anterior de sus registros. No necesita migración del almacenamiento del navegador.
- El adaptador API utiliza `NexoAuth.api`, con la cookie y los permisos reales del backend. No lee ni escribe expedientes en `localStorage`, incluso si falla una petición. Las pruebas del servidor siguen sin poder eliminarse.
- El resumen de Triage acepta el parámetro opcional `ticketIds` (máximo 200 IDs). Devuelve los niveles de esos tickets para la bandeja, las estadísticas y el filtro «sin triage», sin consultar cada expediente. Sin el parámetro conserva la respuesta anterior. Se mantienen `requireAuth` y `requireRole(...STAFF)`; no se modifican migraciones.
- Las estadísticas corresponden a los tickets cargados en la bandeja. El límite actual de la API de tickets sigue siendo 200; el historial API conserva su límite de 100 eventos.
- La vista mantiene selección y borradores separados por modo. Bloquea operaciones duplicadas mientras guarda, muestra errores y descarta respuestas de lectura tardías de otra vista. Si no puede confirmar una escritura API, exige recargar el estado del servidor antes de reintentar; no reenvía automáticamente la operación.
- Cambiar de ticket o filtro con cambios pendientes pide confirmación antes de descartar el formulario. Un diagnóstico editado debe guardarse antes de transferir.
- La transferencia continúa siendo manual: registra el nivel y, opcionalmente, el responsable; no cambia el estado del ticket. Se conserva la posibilidad de transferir entre niveles distintos, sin añadir nuevas reglas de autorización por nivel.

## Comprobaciones

Desde la raíz:

```sh
node --test tests/triage-data.test.cjs
```

Las cinco pruebas cubren compatibilidad del formato demo, persistencia de diagnóstico/pruebas y L1 → L2 → L3, prioridad/asignación, eliminación local, requisitos para transferir, fallos de almacenamiento y ausencia de fallback o escrituras locales desde API.

Además, se comprobó en Chromium el recorrido completo de ambos modos, incluyendo recarga de página. Para API se utilizó el backend real con PostgreSQL 17 en una base exclusiva de pruebas y cuentas de prueba con contraseñas generadas en memoria. Se verificaron estadísticas, filtros, persistencia, permisos 401/403, errores de transporte, respuestas tardías al cambiar de modo y la estructura visual compartida. Los scripts temporales, las cuentas y las capturas de esa ejecución no forman parte del repositorio.

Se revisaron hover, foco por teclado y disabled, con un contraste mínimo medido de 6,02:1 en los textos comprobados de ambos modos. La vista no presenta desbordamiento horizontal a 390 ni 768 píxeles. La comparación de estilos calculados contra `main` en 11 combinaciones de otros módulos y modos no mostró cambios.

También pasan las tres pruebas existentes de contraseñas (`cd backend && npm test`). El chequeo `npm run check` continúa fallando con los tres errores previos: TS5097 en `password.test.ts:3` y TS2554 en `password.ts:15` y `:25`. Su corrección queda fuera de este cambio de Triage.

Para repetir una prueba funcional, iniciar frontend y backend, ingresar en el modo elegido, guardar un diagnóstico y una prueba, transferir a L2 y luego a L3 y recargar. En API verificar la persistencia y el historial con una cuenta IT, y que una cuenta Solicitante no tenga acceso a Triage. Tras actualizar, reiniciar el backend para que esté disponible el parámetro nuevo del resumen.
