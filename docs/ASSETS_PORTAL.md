# Assets y Portal: vistas compartidas

Los modos Demo local y API + PostgreSQL utilizan la misma estructura visual oscura en cada módulo. Se reutilizan las superficies de `css/v12.css`, con ajustes encapsulados en `.nx-workspace` y `.nx-module-dialog` dentro de `css/modules.css`. Se retiraron el antiguo punto de entrada `js/v23.js`, sus renderizadores duplicados y su hoja `css/v23.css`; el dashboard carga directamente las vistas compartidas.

## Organización y decisiones

- `js/assets-ui.js`: inventario, cuatro estadísticas, búsqueda, alta/edición con diálogo nativo y vínculo principal con tickets. Conserva un vínculo existente aunque el ticket no esté en la bandeja cargada.
- `js/portal-ui.js`: centro de ayuda con los cuatro artículos originales, formulario de solicitud, listado y seguimiento por número. Se comparte también con `portal.html`, que continúa siendo una demo pública sin acceso a datos reales.
- `js/modules-data.js`: adaptadores `assets(mode, ctx)` y `portal(mode, ctx, {publicMode})`. La vista no accede directamente a PostgreSQL ni usa almacenamiento demo como alternativa a una petición fallida.
- `js/v12.js`: mantiene las semillas y las exportaciones `assets()`/`activity()` que necesitan Pulse y Relaciones IT; su renderizador dirige Assets y Portal hacia las vistas compartidas. Pulse conserva su implementación.
- Los adaptadores demo mantienen las claves y formatos anteriores de `localStorage`. Antes de crear una solicitud leen el estado persistido para conservar las solicitudes de otra pestaña. Un fallo de almacenamiento no confirma la operación ni modifica el contexto visible; un fallo en el registro auxiliar de actividad no invalida datos principales ya guardados.
- Los adaptadores API utilizan `NexoAuth.api` y los endpoints existentes. Assets requiere personal IT. Portal envía exclusivamente título, tipo y descripción: identidad, prioridad Media y estado Registrado los fija el servidor. El listado y el detalle reales están limitados a las solicitudes de la cuenta autenticada.
- La búsqueda y las estadísticas de Assets corresponden a los activos cargados (máximo 200); Portal muestra como máximo 100 solicitudes propias, con consulta individual por número. No se presentan esos conteos como totales globales.
- Borradores y estados se separan por modo. Durante un guardado se bloquean envíos duplicados. Una respuesta tardía no repinta otra vista. Si no se puede confirmar una escritura API se exige recargar antes de reintentar, sin reenviar automáticamente la petición. Una creación confirmada seguida de un fallo de actualización sigue mostrándose como guardada.
- No hay cambios en backend, permisos, migraciones, dependencias ni lockfiles.

## Verificación

La comprobación de entrega encontró que `main` en GitHub seguía en `f1c699a`, con el renderizador alternativo de `v23.js`; el cambio anterior de Assets/Portal (`1e6dd63`) solo estaba en su rama. Esta corrección parte de ese `main` e incorpora la unificación en `fix/assets-portal-api-ui`. Hasta integrar el PR, actualizar únicamente `main` seguirá entregando la versión anterior.

Para verificar también el HTML servido, el orden de carga y la apariencia en un navegador:

```sh
python3 -m pip install -r tests/requirements-browser.txt
python3 -m playwright install chromium
python3 -m unittest discover -s tests -p 'test_modules_ui.py' -v
```

`tests/test_modules_ui.py` sirve la aplicación y abre Chromium con respuestas API controladas. Compara estructura, estadísticas y centro de ayuda entre modos, exige superficies oscuras y contraste de texto de al menos 4,5:1, comprueba el ancho móvil y falla ante errores JavaScript o recursos faltantes. `NEXODESK_SCREENSHOTS=/ruta/fuera/del/repositorio` guarda ocho capturas (dos módulos, dos modos, escritorio/móvil). La prueba falla contra el `main` anterior y pasa con esta corrección. Estas respuestas simuladas no prueban persistencia; esa parte se comprobó aparte contra PostgreSQL real.

Desde la raíz:

```sh
node --test tests/modules-data.test.cjs tests/triage-data.test.cjs
```

Las nueve pruebas nuevas cubren persistencia demo, IDs y vínculos, duplicados de serie, payloads API, aislamiento del almacenamiento, Portal público, cuotas de almacenamiento, datos inválidos y conservación de solicitudes de otra pestaña. También pasan las cinco pruebas existentes de Triage y las tres de contraseñas (`cd backend && npm test`).

Se probaron en Chromium ambos modos contra el frontend y la API reales. Para PostgreSQL 17 se creó una base exclusiva de pruebas con cuentas y contraseñas generadas en memoria, sin alterar la base habitual. Se verificaron alta/edición/búsqueda y vínculo de activos, duplicados HTTP 409, vínculo fuera de la bandeja, artículos, registro y seguimiento de solicitudes y persistencia tras recargar. La API dejó intactas las claves demo; demo y Portal público no hicieron peticiones API. Se comprobaron HTTP 401/403 y la imposibilidad de consultar solicitudes de otra cuenta.

Pruebas adicionales de navegador con respuestas controladas cubrieron guardados inciertos, recargas fallidas después de un POST confirmado, doble envío y respuestas tardías al cambiar de modo. Se revisaron hover, foco, disabled, opciones nativas y diseños a 390/768/1440 px. El contraste mínimo medido de los textos revisados fue 7,03:1. Trece comparaciones de otros módulos y modos contra `main` no mostraron cambios de estilos calculados.

Los scripts temporales de integración, capturas y credenciales no se incluyen en Git. `npm run check` conserva los tres errores previos: TS5097 en `password.test.ts:3` y TS2554 en `password.ts:15` y `:25`; este cambio no modifica esos archivos.
