# NEXODESK V2.1 — Frontend + API PostgreSQL (entrega incremental)

## Qué cambia

- **Demo local (predeterminado):** los tickets siguen guardándose en `localStorage`, igual que V1.5. No se alteran los tickets existentes.
- **API + PostgreSQL:** Dashboard, Tickets, Kanban, indicadores, edición, creación de tickets y comentarios se cargan/guardan mediante la API V2.1. Se muestra un estado de conexión y guardado.
- **No hay migración automática** desde `localStorage` a la base de datos. Cambiar de modo no copia ni elimina registros.
- **API V2.1:** admite `Consulta`, comentarios y la fuente de creación (`source`) y agrega una segunda migración SQL. El backend conserva el mismo puerto y el resto de las rutas.

## Archivos que trae el ZIP

```
dashboard.html                  REEMPLAZAR
js/app.js                      REEMPLAZAR
js/v21-bridge.js               NUEVO
css/v21.css                    NUEVO
backend/src/server.ts          REEMPLAZAR
backend/src/migrate.ts         REEMPLAZAR
backend/sql/002_frontend_compat.sql  NUEVO
LEEME_V2_1.md                  NUEVO
```

**Copiá el contenido de este ZIP encima de tu carpeta principal de NEXODESK V1.5 + Backend V2.0.** Solo se modifican los archivos indicados; no hay que borrar otros archivos. **Hacé un respaldo** de la carpeta antes de reemplazar archivos.

## Cómo probar modo DEMO SIN PostgreSQL

1. Abrí la carpeta raíz del proyecto en Visual Studio Code.
2. Ejecutá **Live Server** sobre `index.html` (o `dashboard.html` después de iniciar sesión en el login demo).
3. En el dashboard, buscá **Origen de tickets** y elegí **Demo local**.
4. Probá crear/editar tickets, cambiar estado en Kanban y recargar. Deben conservarse en este navegador.
5. El botón **Restablecer demo** solo funciona en modo demo.

## Cuando tengas PostgreSQL configurado

**Requisitos**: Node.js y npm funcionando, PostgreSQL arrancado, usuario y base configurados conforme al archivo `backend/.env` de tu proyecto V2.0.

Abre **Terminal → Nueva terminal** en VS Code y ejecutá (PowerShell en Windows):

```powershell
cd backend
npm.cmd install
# Si todavía no existe el archivo .env:
Copy-Item .env.example .env
# Verificá DATABASE_URL dentro de backend/.env
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

> `npm.cmd` evita el error de bloqueo de `npm.ps1` que encontraste en PowerShell. No publiques ni compartas `.env`.

El servidor debería informar `http://127.0.0.1:3001`. Comprobá `http://127.0.0.1:3001/api/health` y `http://127.0.0.1:3001/api/tickets` en el navegador. **Si falla `db:migrate`, no avances hasta resolverlo.**

Con el backend encendido:

1. Ejecutá también Live Server en el proyecto (habitualmente `http://127.0.0.1:5500`).
2. Entrá al dashboard y elegí **API + PostgreSQL**.
3. Debería indicar `API conectada`. Si indica error, revisá `DATABASE_URL`, si PostgreSQL está encendido y el origen permitido en `backend/.env` (`FRONTEND_ORIGIN`).
4. Creá un ticket y esperá a leer **Cambios guardados en PostgreSQL**. Refrescá la página y comprobá que sigue ahí.
5. Abrí el ticket, agregá un comentario y verificá que aparece después de refrescar.
6. Mové el ticket en Kanban y verificá el estado consultando `http://127.0.0.1:3001/api/tickets`.
7. Elegí **Demo local** para comprobar que tus tickets anteriores siguen intactos.

## Alcance y limitaciones importantes

- La API **todavía no tiene autenticación ni autorización**. No la expongas a Internet ni ingreses información sensible o real de empleados. El login actual sigue siendo simulado.
- Las secciones **Usuarios, Assets, Triage, Relaciones IT y sus metadatos auxiliares siguen siendo locales**. Los tickets que muestran Pulse e Intelligence usan la fuente elegida, pero no hemos migrado todos los módulos a backend.
- La página pública independiente `portal.html` **sigue en modo local solamente**. Para crear tickets de PostgreSQL utilizá el dashboard; la sincronización de Portal público requerirá autenticación/permisos y una ruta propia segura.
- Los comentarios en esta etapa se guardan como un arreglo JSON en el registro del ticket (máximo 100 por ticket); luego podremos normalizarlos en una tabla con auditoría.
- La API lista como máximo **200 tickets**. Es un prototipo, todavía no incluye paginación.
- Una falla al guardar se indica explícitamente y **bloquea la continuación de cambios**. Pulsá `Actualizar` para releer el servidor. La información no confirmada podría perderse: verificá los tickets en la API.
- Las estadísticas preexistentes de tiempo y satisfacción siguen siendo ilustrativas; no representan métricas calculadas del servidor.
- Usá Live Server, no abras archivos con `file://`. Los orígenes CORS iniciales son `http://127.0.0.1:5500` y `http://localhost:5500`.

## Siguientes pasos recomendados

1. **V2.2:** login real (contraseñas con hash), sesiones y autorización por roles.
2. **V2.3:** endpoints propios para Assets, Triage y Portal, asociados a usuarios autenticados.
3. **V2.4:** pruebas automatizadas, auditoría y despliegue seguro.
