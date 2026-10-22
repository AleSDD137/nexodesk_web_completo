# NEXODESK V2.3 — Assets, Triage y Portal con PostgreSQL

> **Repositorio actual:** Assets y Portal utilizan `js/assets-ui.js`, `js/portal-ui.js`, `js/modules-data.js` y `css/modules.css` en ambos modos. `js/v23.js` y `css/v23.css` fueron retirados. Consultá [la arquitectura y las pruebas actuales](docs/ASSETS_PORTAL.md). Las instrucciones de copia de ZIP y la tabla siguientes describen el paquete V2.3 original; no vuelvas a superponer esos archivos antiguos sobre el checkout actualizado.

**Esta entrega es un parche incremental sobre V2.2.** Contiene únicamente archivos nuevos o modificados; no reemplaza el proyecto completo. El modo **Demo local** sigue funcionando sin configurar el backend.

## 1. Archivos que incorpora

| Archivo | Operación |
| --- | --- |
| `backend/sql/004_assets_triage_portal.sql` | Nuevo: tablas `assets`, `triage_cases`, `triage_tests`, `triage_events` |
| `backend/src/modules-v23.ts` | Nuevo: rutas HTTP para Assets, Triage y Portal |
| `backend/src/server.ts` | Reemplazar: registra el módulo y amplía el manejo de errores |
| `backend/src/migrate.ts` | Reemplazar: agrega migración 004 |
| `js/v23.js` | Nuevo: interfaces API de Assets, Triage y Portal |
| `js/v22-auth.js` | Reemplazar: permisos de navegación adecuados a los módulos V2.3 |
| `js/v21-bridge.js` | Reemplazar: permite recargar tickets desde PostgreSQL después de un cambio |
| `css/v23.css` | Nuevo: estilos de módulos de servidor |
| `dashboard.html` | Reemplazar: carga CSS y JS nuevos |
| `portal.html` | Reemplazar: aclara que el Portal público sigue siendo una demo sin autenticación |
| `LEEME_V2_3.md` | Nuevo: estas instrucciones |

`login.html`, `js/app.js`, `js/v12.js`, `js/v15.js`, `css/styles.css`, `backend/package.json`, scripts anteriores y demás archivos **no cambian**.

## 2. Instalar en Visual Studio Code (Windows)

1. Cerrá Live Server y detené el backend si está abierto (`Ctrl+C` en su terminal).
2. Hacé **una copia completa** de tu carpeta NEXODESK V2.2 antes de modificarla.
3. Extraé el ZIP y copiá sus archivos a la raíz de NEXODESK, conservando las subcarpetas `backend`, `js` y `css`.
4. Cuando Windows pregunte, reemplazá **solo los archivos que aparecen como «Reemplazar»** en la tabla.
5. Si todavía no habías configurado V2.2, primero terminá PostgreSQL y el primer administrador (véase `LEEME_V2_2.md`).

El modo **Demo local** funciona sin PostgreSQL: iniciá sesión en `login.html` eligiendo Demo local y probá lo que ya tenías. Los nuevos endpoints no se ejecutan hasta elegir **Cuenta real (PostgreSQL)**.

## 3. Instalar/actualizar la base de datos

En VS Code abrí **Terminal > Nueva terminal** y ubicáte dentro de `backend`:

```powershell
cd backend
npm.cmd install
```

Revisá tu archivo `backend/.env`: tiene que apuntar al usuario, contraseña y base de datos que creaste en **pgAdmin 4**. No pegues contraseñas reales en el chat, ni subas `.env` a Git.

Con PostgreSQL **ya encendido y accesible**:

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

No hace falta ejecutar `db:seed` nuevamente si ya tenés tickets y usuarios. El migrador vuelve a aplicar las migraciones anteriores de forma idempotente y agrega la 004. Los datos demo **no se importan** a PostgreSQL automáticamente. Si necesitás crear un administrador real y todavía no lo hiciste, consultá `LEEME_V2_2.md` y el comando `npm.cmd run auth:bootstrap`.

En el navegador comprobá que `http://127.0.0.1:3001/api/health` responda con `ok: true` y `database: connected`.

## 4. Ejecutar el frontend y probar

1. Abrí `index.html` con **Live Server** desde VS Code (idealmente puerto 5500).
2. Usá la **misma variante de host** para frontend y backend: `127.0.0.1` con `127.0.0.1`, o `localhost` con `localhost`. No abras la página como `file://`.
3. Entrá a `login.html` y elegí **Cuenta real (PostgreSQL)**. Usá el usuario real creado en V2.2.
4. Comprobá que el selector **Origen de tickets** indique `API + PostgreSQL`.
5. Visitá **Assets**, creá un equipo, editá su ubicación y vinculá un ticket existente. Recargá la página: el equipo debe seguir allí.
6. Visitá **Triage L1–L3**, abrí un ticket, guardá un diagnóstico con una prueba; después indicá motivo y próximos pasos para transferirlo a otro nivel. Recargá y comprobá el historial.
7. Visitá **Portal** (dentro del dashboard), creá una solicitud y verificá que aparezca en **Mis solicitudes**, **Tickets** y **Kanban**.
8. Cerrá sesión, entrá como **Solicitante** y comprobá que se ve **Portal**, pero **no Assets ni Triage**. Las comprobaciones de permisos ocurren también en la API.

### Prueba sin PostgreSQL

Ingresá con **Demo local** en el login. Podés probar Assets, Triage y Portal anteriores desde `localStorage`, sin utilizar datos del servidor. Los datos locales y los datos reales **no se mezclan**.

## 5. API nueva (todos los endpoints exigen sesión real)

| Verbo y ruta | Permiso | Uso |
| --- | --- | --- |
| `GET /api/assets` | Personal IT | Lista de equipos (máximo 200) |
| `POST /api/assets` | Personal IT | Crear activo |
| `PATCH /api/assets/:id` | Personal IT | Modificar activo |
| `GET /api/triage/:ticketId` | Personal IT | Expediente de triage |
| `PUT /api/triage/:ticketId` | Personal IT | Guardar diagnóstico y prueba |
| `POST /api/triage/:ticketId/transfer` | Personal IT | Transferencia manual con motivo y próximos pasos |
| `GET /api/triage/assignees` | Personal IT | Técnicos disponibles para transferencia |
| `GET /api/triage/summary` | Personal IT | Estadísticas básicas del triage |
| `GET /api/portal/my-requests` | Usuario autenticado | Solicitudes **propias** según correo verificado |
| `POST /api/portal/requests` | Usuario autenticado | Crear solicitud con identidad comprobada |
| `GET /api/portal/requests/:id` | Propietario autenticado | Consultar una solicitud propia |

*Personal IT* = Administrador, Coordinador o Técnico. El backend **nunca acepta** identidad, prioridad o estado suministrados por el cliente de Portal: los fija según la sesión y el flujo definido.

## 6. Límites actuales

- **`portal.html` público es demo:** no existe alta anónima de solicitudes reales. Para usar PostgreSQL hay que iniciar sesión y abrir **Portal dentro del dashboard**. Esto evita incorporar un endpoint público sin captcha, validación de identidad ni medidas antiabuso.
- **Assets:** un ticket principal por equipo. Los vínculos *adicionales* del mapa Relaciones IT V1.3 continúan solo en demo. El mapa Relaciones IT, Pulse e Intelligence siguen ocultos en modo API hasta que tengan integración propia.
- **Triage:** guarda diagnóstico, pruebas e historial en PostgreSQL y ejecuta transferencias manuales. No se permite borrar pruebas del historial mediante la interfaz real; se mantiene trazabilidad.
- **Portal:** cada cuenta consulta las solicitudes asociadas a su correo. Tickets antiguos sin `requester_email` no aparecerán en «Mis solicitudes» hasta que se les asigne un correo válido mediante una migración revisada.
- Los módulos reales requieren sesión vigente y permisos de servidor. Ningún dato demo se importa automáticamente.
- La instalación está diseñada para **desarrollo local**. Antes de publicar se requieren HTTPS, configuración segura de hosting, auditoría, paginación, controles de acceso más granulares, backups y pruebas de integración con PostgreSQL.

## 7. Si aparece un error

- **`npm.ps1` bloqueado:** ejecutá `npm.cmd` en PowerShell.
- **`ECONNREFUSED` / servidor inaccesible:** verificá `npm.cmd run dev`, PostgreSQL y el puerto 3001.
- **`relation "assets" does not exist`:** falta `npm.cmd run db:migrate` en la **misma base** a la que apunta `.env`.
- **`401` o «Iniciá sesión»:** regresá al login y elegí **Cuenta real (PostgreSQL)**.
- **`403` permisos:** tu rol no está autorizado para esa operación.
- **`409` al transferir:** falta diagnóstico y al menos una prueba, o no se puede transferir al mismo nivel.
- **`409` al guardar activo:** revisá que el número de serie no esté repetido.
- Si elegís el modo API y no hay conexión, **NO** se escribirá en `localStorage` como alternativa silenciosa.

**Estado de verificación:** se comprobaron sintaxis de JS, estructura HTML/ZIP y presencia de rutas y migraciones. La ejecución completa contra PostgreSQL en tu equipo aún está pendiente; esta entrega no incluye una base real instalada.
