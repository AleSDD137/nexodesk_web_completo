# NEXODESK V2.2 — Autenticación real y roles (actualización incremental)

Esta entrega continúa **NEXODESK V2.1**. **No** es un proyecto completo independiente: el ZIP contiene **únicamente los archivos nuevos o modificados**. No borra tickets demo ni reemplaza las páginas de Pulse, Assets, Intelligence, Triage o Portal.

## Qué cambia

- **Login con dos modos**: `Demo local` (como antes, sin servidor) y `Cuenta real (PostgreSQL)`.
- **Sesiones reales**: cookie de sesión `HttpOnly`, `SameSite=Strict`, duración de 12 horas, token aleatorio de 32 bytes (solo se almacena su hash SHA-256 en PostgreSQL), revocación al cerrar sesión. **No se almacenan contraseñas ni tokens en localStorage**.
- **Contraseñas con hash scrypt**, sal aleatoria por cuenta, y verificación de tiempo constante; longitud mínima de 12 caracteres.
- **Usuarios y roles en PostgreSQL**: Administrador, Coordinador, Técnico (L1/L2/L3), Solicitante.
- **Autorización del lado del servidor**. No se puede saltar cambiando botones o parámetros del navegador. Ver tabla de permisos.
- **Administrador inicial**: comando local que genera una contraseña aleatoria; no hay credenciales fijas en el código.
- **Administración de cuentas**: crear cuentas, activar/desactivar y establecer una contraseña inicial o restablecerla (Administrador). El administrador puede cambiar su propia contraseña desde Configuración.
- **Tickets reales**: en modo PostgreSQL se requiere sesión válida. Solicitante ve solo los tickets asociados a su correo (`requester_email`), puede crear tickets propios y comentar. Técnicos/Coordinadores/Administradores pueden modificar tickets. Comentarios se registran con autor y fecha determinados por el servidor.
- **Modo demo preservado**: los módulos aún locales no se pierden, pero se ocultan al usar sesión real para no confundir datos simulados con datos corporativos.

## Archivos incluidos en el ZIP

```text
LEEME_V2_2.md                        NUEVO
backend/package.json                REEMPLAZAR
backend/sql/003_auth.sql             NUEVO
backend/src/migrate.ts              REEMPLAZAR
backend/src/server.ts               REEMPLAZAR
backend/src/auth.ts                 NUEVO
backend/src/password.ts             NUEVO
backend/src/password.test.ts        NUEVO
backend/src/bootstrap.ts            NUEVO
dashboard.html                       REEMPLAZAR
login.html                           REEMPLAZAR
css/v22.css                          NUEVO
js/app.js                            REEMPLAZAR
js/login.js                          REEMPLAZAR
js/v21-bridge.js                     REEMPLAZAR
js/v22-auth.js                       NUEVO
```

No hace falta volver a copiar `index.html`, `portal.html`, `css/styles.css`, `css/v12.css`, los demás JS ni otros módulos que ya tengas instalados.

## Instalación en VS Code (Windows + PowerShell)

1. **Hacé una copia de seguridad** de la carpeta NEXODESK que ya contiene frontend V1.5 y backend V2.1.
2. Descomprimí `nexodesk_v2_2_actualizacion.zip`. **Copiá el contenido encima de la raíz del proyecto**, respetando carpetas. Confirmá reemplazar solo los archivos listados arriba.
3. Abrí VS Code → `Archivo → Abrir carpeta` → tu carpeta NEXODESK.
4. Elegí `Terminal → Nueva terminal` (abajo aparecerá PowerShell).
5. Desde la carpeta raíz, ejecutá:

```powershell
cd backend
npm.cmd install
```

> Como PowerShell en tu PC bloqueaba `npm.ps1`, usá `npm.cmd` tal como hicimos antes. Node.js 22 o superior recomendado.

### Configurar PostgreSQL

Si ya habías hecho V2.1, **conservá tu `backend/.env`**. No borres la base de datos. Si todavía no lo tenés:

```powershell
Copy-Item .env.example .env
```

Abrí `backend/.env` y verificá, por ejemplo:

```env
HOST=127.0.0.1
PORT=3001
FRONTEND_ORIGIN=http://127.0.0.1:5500,http://localhost:5500
DATABASE_URL=postgresql://nexodesk:TU_CLAVE_LOCAL@localhost:5432/nexodesk
```

**Son valores de ejemplo**. Usá tu contraseña real de PostgreSQL (si incluye símbolos como `@` o `#`, codificalos para URL). La base `nexodesk` y el usuario PostgreSQL indicado deben existir. El archivo `.env` **no se comparte ni se sube a repositorios**.

Si PostgreSQL todavía no está configurado, podés abrir el proyecto igual y seguir con **Demo local**; los siguientes comandos de backend tendrán que esperar.

### Crear/actualizar tablas

En la terminal que ya está dentro de `backend`:

```powershell
npm.cmd run db:migrate
```

Ejecuta `001_init.sql`, `002_frontend_compat.sql` y la nueva `003_auth.sql`. Son migraciones repetibles en esta versión. **No borra tus tickets existentes**. Si falla, revisá la conexión y no ejecutes el paso siguiente hasta resolverlo.

Si querés agregar los tickets y usuarios de ejemplo, podés usar (opcional):

```powershell
npm.cmd run db:seed
```

**Atención:** los usuarios agregados por el `seed` anterior **no tienen contraseña** y no pueden ingresar hasta que el Administrador les establezca una.

### Crear el primer administrador

**Solo una vez**, desde `backend`:

```powershell
npm.cmd run auth:bootstrap -- "Administrador NEXODESK" "admin@ejemplo.com"
```

Cambiá el nombre y correo por los que realmente quieras. El correo no debe existir ya en `users`. El comando imprimirá una **contraseña aleatoria temporal** una sola vez en la terminal. Copiala en un lugar privado para iniciar sesión, después **cambiala** desde el dashboard (Configuración). No envíes capturas de esa contraseña.

Este comando no permite crear un segundo administrador inicial si ya hay uno con contraseña. Los demás usuarios se crean desde la interfaz con rol Administrador.

### Iniciar servidor y frontend

Desde `backend`:

```powershell
npm.cmd run dev
```

Dejá esa terminal abierta. Debería indicar `NEXODESK API V2.2 en http://127.0.0.1:3001`.

- Verificá `http://127.0.0.1:3001/api/health`. **No** es necesario iniciar sesión para el estado de salud.
- Los endpoints `/api/tickets` y `/api/users` **ahora requieren sesión y permisos**. Es normal ver `401` al abrirlos directamente sin ingresar.
- En VS Code, abrí `index.html` con **Live Server** (usualmente puerto 5500).
- En `login.html`, elegí **Cuenta real (PostgreSQL)**, ingresá el correo y la contraseña temporal del paso anterior, y accedé al dashboard.
- Abrí **Configuración** y cambiá la contraseña temporal.

> Importante: usá el **mismo hostname** (`localhost` o `127.0.0.1`) en frontend y backend. El JavaScript usa el hostname con que abriste Live Server para conectarse al puerto 3001; las cookies `SameSite=Strict` funcionan si ambos usan el mismo hostname. Si Live Server funciona en otro puerto, agregá el origen completo a `FRONTEND_ORIGIN` dentro de `.env` y reiniciá el servidor.

## Prueba rápida

1. Iniciá sesión como administrador real. Confirmá que aparezca tu nombre/rol en el menú y la barra muestre `API + PostgreSQL`.
2. Abrí **Usuarios**. Creá un usuario `Técnico`, asignale nivel `1` y contraseña de 12 caracteres como mínimo.
3. Creá un usuario `Solicitante`, elegí su correo y contraseña.
4. Como Administrador, creá un ticket. Si querés que el Solicitante lo vea, indicá su correo como `requesterEmail` desde una futura función administrativa (V2.2 permite crear tickets propios directamente como Solicitante).
5. Cerrá sesión. Ingresá como Solicitante; creá un ticket y agregá un comentario. Intentá abrir otros tickets con un ID diferente: la API no los entregará.
6. Cerrá sesión y entrá como Técnico L1. Verificá que puede ver los tickets y editar su estado.
7. Apagá el backend e ingresá en **Demo local**. El frontend de demostración debería seguir funcionando sin PostgreSQL.

## Roles y permisos en esta versión

| Operación API | Administrador | Coordinador | Técnico L1-L3 | Solicitante |
|---|---|---|---|---|
| Iniciar sesión / cambiar contraseña propia | Sí | Sí | Sí | Sí |
| Ver todos los tickets | Sí | Sí | Sí | No: solo propios |
| Crear ticket | Sí | Sí | Sí | Sí, siempre propio |
| Cambiar estado, prioridad y asignación | Sí | Sí | Sí | No |
| Agregar comentarios | Sí | Sí | Sí | Sí, solo a sus tickets |
| Ver cuentas | Sí | Sí | No | No |
| Crear/desactivar/activar cuentas y resetear contraseñas | Sí | No | No | No |

L1/L2/L3 son **atributos del usuario Técnico**, todavía sin reglas de escalamiento entre niveles a nivel de API (esas reglas serán parte de una versión futura de Triage). Los permisos no se basan en ocultar botones: se verifican también en las rutas del servidor.

## Pruebas automatizadas incluidas

Desde `backend`:

```powershell
npm.cmd run test
```

Prueba la derivación de contraseñas con `scrypt`, sal aleatoria, verificación correcta/incorrecta, rechazo de claves cortas y hash de tokens. La ejecución completa del backend, la migración de PostgreSQL y la integración real con navegador **requieren que los pruebes en tu equipo**.

## Limitaciones importantes

- **Este prototipo no está listo para publicarse en Internet.** Para producción hacen falta HTTPS real, cookies `Secure`, configuración de proxy, backups, monitoreo, logs/auditoría, políticas de bloqueo persistentes, recuperación de contraseña, pruebas de seguridad e implementación de autorizaciones para todos los módulos.
- La limitación de intentos de login está en la **memoria del proceso** (se reinicia al reiniciar Node). Es una protección local inicial, no una solución de producción.
- El modo demo **no valida contraseñas**: se distingue claramente del acceso real. **Nunca uses datos sensibles de empresa en demo/localStorage**.
- Assets, Portal público, Relaciones IT, Intelligence, Triage y otros metadatos todavía **no están migrados** a la base de datos ni tienen autorización real; se ocultan en modo API. Su integración vendrá después.
- El frontend de modo API todavía usa un adaptador incremental de sincronización para tickets; se deben hacer pruebas funcionales antes de uso real.
- La relación `requester_email` se agrega en V2.2. Tickets históricos importados del prototipo pueden tener `requester_email=NULL`, por lo cual no serán visibles para un usuario Solicitante, aunque el nombre coincida. Un ticket nuevo creado por Solicitante sí queda correctamente asociado.
- **No es posible recuperar la contraseña original** de una cuenta. El Administrador puede establecer una nueva desde Usuarios.

## Recomendación V2.3

Migrar los módulos de activos, triage y portal a API con permisos y auditoría, agregar búsqueda/paginación y conectar identidad de solicitantes a los tickets generados por personal de soporte.
