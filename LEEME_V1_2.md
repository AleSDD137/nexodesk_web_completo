# NEXODESK V1.2 — parche incremental

**Base requerida:** NEXODESK V1.1 instalada sobre el paquete web anterior. Este ZIP contiene **solo archivos nuevos o modificados**.

## Archivos que se reemplazan
- `dashboard.html` — agrega tres opciones al menú y carga dos recursos nuevos.
- `index.html` — agrega enlace al Portal público.
- `js/app.js` — integra las nuevas vistas con tickets y navegación de V1.1.

## Archivos nuevos
- `portal.html` — Portal público para empleados (sin login de demostración).
- `js/v12.js` — lógica de Pulse, Assets, Portal y almacenamiento local compartido.
- `css/v12.css` — estilos de los nuevos módulos, sin reemplazar estilos existentes.

**No reemplazar:** `login.html`, `js/login.js`, `css/styles.css`, `css/landing.css`, `css/login.css` ni otros archivos de V1.1.

## Instalación
1. Hacé una **copia de seguridad** de la carpeta NEXODESK V1.1.
2. Extraé este ZIP y copiá **el contenido de `nexodesk_v1_2_patch/`** dentro de la carpeta de tu proyecto, respetando la estructura de carpetas.
3. Aceptá reemplazar únicamente los tres archivos indicados. **No reemplaces toda la carpeta del proyecto.**
4. Abrí `index.html` desde la extensión **Live Server** de VS Code. Ingresá por el login de demostración y luego a `dashboard.html`.
5. En la barra lateral aparecen **Pulse, Assets y Portal**. `portal.html` abre directamente el portal para empleados.

## Prueba del circuito
1. Entrá a **Portal** (o `portal.html`) y creá una solicitud. Anotá el número #.
2. Entrá en **Tickets**: debe aparecer el nuevo ticket. También aparece en **Kanban** (estado Registrado).
3. Entrá a **Pulse**: se recalculan las estadísticas de tickets abiertos. (Si lo tenías abierto en otra pestaña, recargá la página.)
4. Entrá a **Assets**, pulsá **Nuevo activo** y enlazalo al número de ticket creado.
5. Regresá a **Pulse**: el contador de activos vinculados aumentará si el ticket sigue abierto.
6. Desde **Assets**, pulsá el número de ticket para abrir sus detalles.
7. Desde `portal.html`, buscá VPN y consultá un ticket por su número.

## Limitaciones de seguridad y alcance
- Esta versión es un **prototipo frontend**, no un sistema multiusuario. Las cuentas del login son demostrativas y el portal público no autentica usuarios.
- Los datos se guardan en **localStorage** del mismo origen del navegador. No se comparten entre computadoras, perfiles o navegadores distintos. No uses datos reales, contraseñas ni datos sensibles.
- El índice Pulse es **ilustrativo**: no mide servicios reales ni hace monitoreo de red. Los artículos del Portal son guías de demostración.
- La información de V1.1 se conserva usando la misma clave de tickets (`nexodesk-demo-tickets-v1`). Los activos y eventos usan claves nuevas independientes.
- Para producción: backend, base de datos, autorización por roles, auditoría persistente y validaciones de servidor.
