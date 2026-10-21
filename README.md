# NEXODESK — Página pública, login y dashboard

Proyecto frontend de demostración para el Sistema de Gestión de Tickets para Soporte IT.

## Cómo ejecutarlo en Visual Studio Code

1. Descomprimí `nexodesk_web_completo.zip`.
2. Abrí la carpeta `nexodesk` (la carpeta que contiene `index.html`, `dashboard.html`, `css` y `js`) en Visual Studio Code.
3. Instalá la extensión **Live Server** si todavía no la tenés.
4. Hacé clic derecho sobre `index.html` y seleccioná **Open with Live Server**.
5. Desde la página principal, pulsá **Iniciar sesión**. Ingresá cualquier correo válido y una contraseña de 4 caracteres o más para probar la navegación.

Se recomienda Live Server en lugar de abrir los archivos directamente con `file://`, porque la demo usa `sessionStorage` y `localStorage` del navegador.

## Estructura del proyecto

- `index.html`: nueva página principal pública de NEXODESK.
- `login.html`: nueva pantalla de inicio de sesión de demostración.
- `dashboard.html`: dashboard original del proyecto, conservado con cambios puntuales para mostrar el usuario demo y cerrar sesión.
- `css/landing.css`: estilos exclusivos de la página pública.
- `css/login.css`: estilos exclusivos de la página de login.
- `css/styles.css`: estilos originales del dashboard, con el agregado del enlace de cierre de sesión.
- `js/login.js`: validación básica del formulario y simulación de inicio/cierre de sesión.
- `js/app.js`: lógica original del dashboard, con una comprobación de sesión de demostración y el cierre de sesión.

## Cómo funciona el login actual

Esta es una **simulación frontend**, no una autenticación real. Para probarla, escribí un correo válido y una contraseña de al menos 4 caracteres. La sesión se guarda temporalmente en el navegador y el dashboard muestra el nombre derivado del correo. No existe validación contra usuarios almacenados en un servidor.

No uses información real o sensible ni publiques esta versión como sistema productivo. La comprobación en JavaScript solo controla la navegación visual y se puede eludir; no constituye una medida de seguridad.

## Preparado para futuras etapas

Para convertirlo en una aplicación multiusuario real, el siguiente paso es implementar un backend (por ejemplo, Node.js + Express o NestJS), una base de datos (PostgreSQL), autenticación segura mediante sesiones o tokens, autorización por roles y una API para tickets, usuarios, comentarios e historial. Las credenciales deberán validarse en el servidor y las contraseñas almacenarse mediante hash seguro; nunca en texto plano.

## Funcionalidad que ya tenía el dashboard

- Tablero Kanban con cinco estados.
- Búsqueda y filtro por prioridad.
- Alta de tickets mediante formulario.
- Vista de tickets en tabla y cambio de estado.
- Vistas de procesos, reportes y configuración.
- Persistencia local de los tickets en el navegador.

Los tickets siguen siendo datos de demostración guardados en el navegador, no una base de datos compartida.
