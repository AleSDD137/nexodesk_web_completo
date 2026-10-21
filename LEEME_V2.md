# NEXODESK V2 — Backend inicial (solo archivos nuevos)

**Esta entrega no modifica tu frontend V1.5.** Agregá la carpeta `backend` en la raíz de NEXODESK.

## Requisitos
- Node.js 22 o superior
- PostgreSQL 16/17 instalado, **o Docker Desktop** para levantar PostgreSQL con el archivo `docker-compose.yml`
- VS Code y una terminal PowerShell

## Cómo ejecutarlo

1. Abrí el proyecto en VS Code y entrá a la terminal:
   ```powershell
   cd backend
   ```
2. Si tenés Docker Desktop abierto:
   ```powershell
   docker compose up -d
   ```
   Si instalaste PostgreSQL manualmente, creá usuario/base `nexodesk` y adaptá la URL de conexión.
3. Copiá `.env.example` a `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
4. Instalá las dependencias (necesita Internet):
   ```powershell
   npm install
   ```
5. Creá las tablas y cargá ejemplos:
   ```powershell
   npm run db:migrate
   npm run db:seed
   ```
6. Iniciá la API:
   ```powershell
   npm run dev
   ```
7. Visitá `http://127.0.0.1:3001/api/health` y `http://127.0.0.1:3001/api/tickets`.

## Rutas disponibles
| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Confirma conexión con PostgreSQL |
| GET | `/api/users` | Lista usuarios de demostración |
| GET | `/api/tickets` | Lista hasta 200 tickets, acepta `?status=Registrado` y `?search=ERP` |
| GET | `/api/tickets/:id` | Consulta ticket |
| POST | `/api/tickets` | Crea ticket |
| PATCH | `/api/tickets/:id` | Modifica campos permitidos |

Ejemplo desde PowerShell (con la API iniciada):
```powershell
$body = @{ title='No funciona la VPN'; description='Error al conectar'; requester='Usuario de prueba'; priority='Alta' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/tickets' -Method Post -ContentType 'application/json' -Body $body
```

## Importante
- El frontend continúa usando `localStorage` y su login **de demostración**. Todavía NO utiliza la API.
- El backend **no tiene autenticación ni autorización**: está restringido por defecto a `127.0.0.1`, solamente para aprendizaje y pruebas. No lo publiques en Internet ni uses información real/sensible todavía.
- CORS no reemplaza la autenticación. No expongas PostgreSQL a Internet.
- `.env` y `node_modules` deben permanecer fuera del repositorio.
- Las credenciales de `docker-compose.yml` son **solo para desarrollo local**; reemplazalas si lo usás en otro entorno.
- El siguiente paso será diseñar autenticación y roles reales, y luego migrar gradualmente las operaciones del frontend a la API.
