# NEXODESK V2.8 — Inventario avanzado

## Implementación

Se conserva Assets y el modelo V2.5. El espacio de Inventario avanzado comparte
su vista entre Demo Local y API + PostgreSQL: listado paginado, búsqueda por
serie/equipo/responsable/ubicación, filtro de estado, apertura de Assets,
historial, importación con vista previa y exportación CSV.

La importación no elimina activos ausentes del archivo. Nunca asocia personas
por coincidencia de nombres. Las series son únicas sin distinguir mayúsculas.
Una fila inválida impide confirmar todo el lote; no se importan lotes parciales.

## CSV y confirmación

- Codificación UTF-8, BOM opcional, delimitador coma, comillas dobles escapadas
  y saltos de línea dentro de celdas entre comillas.
- Columnas requeridas exactas: `kind,brand,serial,owner,location,state`.
- Columnas opcionales: `ticketId,ownerUserId`. Omitir una columna conserva el
  vínculo existente; una celda vacía en una columna incluida expresa su retiro.
- Hasta 200 filas y 24 KB de CSV por lote; errores por número de registro lógico
  (cabecera = 1; una celda multilínea sigue siendo un solo registro).
- Tipos: Notebook, Tablet, Teléfono, Monitor, Impresora, Otro. Estados:
  Disponible, Asignado, En reparación, Baja.
- Los IDs deben existir; las cuentas responsables deben estar activas.
- Series repetidas dentro del archivo se reportan como errores, sin elegir
  arbitrariamente una fila ganadora. Columnas desconocidas/duplicadas fallan.
- Para actualizar series existentes hay que marcar la autorización y generar
  una nueva vista previa. Se muestra la acción prevista por fila.
- La vista previa válida produce un token firmado por el servidor, vinculado
  al usuario, contenido CSV, autorización y versiones de los activos afectados.
  Vence en 15 minutos. No se acepta un resumen enviado libremente por el cliente.
- Confirmar vuelve a analizar y validar el CSV dentro de una transacción con
  bloqueo de escrituras de Assets. Si cambiaron los datos después de la vista
  previa, se exige repetirla. El token de un lote ya aplicado no lo reaplica.
- Clave de firma efímera en memoria: reiniciar el servidor invalida vistas
  previas pendientes; deben regenerarse. No se requiere una nueva credencial.

Excel puede abrir/exportar estos CSV: usar **CSV UTF-8 delimitado por comas**.
No se añadió un lector de `.xlsx` ni ejecución de macros. CSV con punto y coma
debe convertirse al delimitador documentado. La plantilla se descarga desde la UI.

## Trazabilidad y esquema

La migración incremental `009_inventory.sql` añade únicamente `asset_events`:

| Campo | Tipo / regla |
| --- | --- |
| id | BIGSERIAL, PK |
| asset_id | BIGINT NOT NULL, FK assets, ON DELETE RESTRICT |
| actor_id | BIGINT nullable, FK users, ON DELETE SET NULL |
| actor_name | VARCHAR(120), nombre documentado al guardar |
| kind | created, updated, imported, owner_linked |
| changes | JSONB objeto, valores anteriores/nuevos |
| created_at | TIMESTAMPTZ, clock_timestamp() del servidor |

Índice `(asset_id,created_at DESC,id DESC)` para el historial. La creación y
edición existentes de Assets registran sus cambios en la misma transacción.
El helper `recordAssetChange` integra además asociaciones formales de cuentas.
Se registran responsables textuales/formales, ubicación, estado, tipo, equipo,
serie y vínculo principal cuando cambian. Un cambio sin diferencias no añade
un evento vacío. No se reconstruye ni inventa un historial de datos anteriores.

Los vínculos adicionales V2.5 permanecen en `asset_ticket_links`; importar no
los elimina. Las ubicaciones y estados continúan en sus campos existentes;
no se crean catálogos duplicados ni se infieren movimientos históricos.

## API y permisos

Todas las rutas requieren sesión. Solicitante recibe 403 y anónimo, 401.

| Método / ruta `/api` | Acceso | Resultado |
| --- | --- | --- |
| GET `/inventory/assets` | Personal IT | Búsqueda/estado, limit 1–100 (20), offset, total real |
| GET `/inventory/assets/:id/history` | Personal IT | Eventos, limit 1–100 (50), offset, total |
| GET `/inventory/export` | Personal IT | CSV completo del filtro, sin límite de página de Assets |
| POST `/inventory/import/preview` | Administrador/Coordinador | `{csv,updateExisting}` → validación por fila y token |
| POST `/inventory/import/commit` | Administrador/Coordinador | Mismo contenido + token → altas/actualizaciones confirmadas |

Exportación permite `search`, `state` y `format=csv|json`. JSON devuelve
`{data:{csv,filename,total}}` para el adaptador del navegador. CSV es el formato
predeterminado. Se exportan todos los resultados del filtro hasta 10.000;
superado ese umbral se rechaza con 422 y se pide refinar el filtro, sin presentar
una muestra parcial como exportación completa. Celdas que podrían activar
fórmulas en hojas de cálculo reciben prefijo apóstrofo, también si comienzan
con espacios, tabulaciones o retornos antes de `=`, `+`, `-` o `@`.

El cuerpo HTTP de importación admite 128 KB para el CSV más el token firmado;
el CSV mantiene el límite independiente de 24 KB. No se cambian contratos ni
permisos de la edición individual de Assets.

## Frontend y Demo

`NexoInventory.render(ctx,root)` usa `inventory-data.js` como adaptador. La vista
incluye estados de carga/error, invalidación de confirmación al editar el CSV,
confirmación explícita, tablas desplazables internamente, foco visible y texto
escapado antes de insertar HTML.

Demo usa el inventario existente `nexodesk-demo-assets-v12`, los responsables
formales de Relaciones `nexodesk-demo-asset-users-v25` y un historial separado
`nexodesk-demo-inventory-history-v28`. Su importación respeta esos vínculos.
`saveDemoRecord` permite a los adaptadores existentes registrar cambios locales.
Los fallos de escritura local no confirman la operación y restauran los valores
auxiliares previos cuando falla el guardado principal. localStorage no ofrece
transacciones entre pestañas; para concurrencia y garantías ACID se utiliza API.

La rama API del adaptador no accede a claves Demo y propaga errores del servidor.

## Archivos

- `backend/sql/009_inventory.sql`
- `backend/src/inventory.ts`, `inventory-csv.ts`, `inventory-history.ts`
- `backend/src/modules-v23.ts`: solo POST/PATCH de activos, con historial atómico.
- `js/inventory-data.js`, `js/inventory-ui.js`, `css/inventory.css`
- `backend/src/inventory-csv.test.ts`, `tests/test_inventory.py`
- Integración de navegación, rutas, migraciones y helper de responsables en los
  archivos compartidos, documentada en el plan integrado V2.6–V2.9.

## Pruebas

Pruebas unitarias CSV: 5 aprobadas con
`node --experimental-strip-types --test src/inventory-csv.test.ts` desde backend.
Cubren comillas/BOM/multilínea, errores de cabeceras, duplicados, límites y
protección de fórmulas al exportar.

`tests/inventory-data.test.cjs`: 3 pruebas aprobadas de aislamiento API/Demo,
asociaciones explícitas, preservación/retiro de vínculos opcionales, vista previa
obsoleta y restauración del historial auxiliar ante un fallo de cuota local.

`tests/test_inventory.py` añade integración PostgreSQL: permisos, filas inválidas,
token manipulado/ajeno/repetido, confirmación explícita, vista previa obsoleta,
persistencia del historial, conservación de vínculos y exportación de más de
200 activos y actualización de 200 filas existentes con un cuerpo de confirmación
mayor a 32 KB (validación del límite HTTP específico). El resultado ejecutado se registra en el plan integrado final.

La migración debe aplicarse primero en una base aislada con 001–008. Usa
`CREATE ... IF NOT EXISTS`, sin borrar/recrear tablas ni modificar datos previos.
No se ejecuta contra PostgreSQL personal del estudiante durante estas pruebas.

## Limitaciones expresas

- No hay importador nativo Excel `.xlsx`; CSV es la vía compatible.
- No hay sincronización automática ni eliminación por ausencia en archivos.
- No se inventa historial anterior a la actualización.
- Exportaciones mayores a 10.000 requieren filtros; importaciones mayores a
  200 filas se dividen. No hay tareas masivas en segundo plano en esta versión.
- No se expone una edición/eliminación de eventos históricos.
