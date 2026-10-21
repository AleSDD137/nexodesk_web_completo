# NEXODESK V1.4 — Intelligence

**Requiere:** NEXODESK V1.3 instalada y operativa. Esto es una **actualización incremental**, no un proyecto completo.

## Instalación
1. Respaldá tu carpeta de NEXODESK V1.3.
2. Copiá desde este parche `dashboard.html` y `js/app.js` a las mismas rutas del proyecto original (reemplazalos).
3. Agregá **sin reemplazar** los nuevos archivos `js/v14.js` y `css/v14.css`.
4. Conservá el resto de los archivos: `index.html`, `login.html`, `portal.html`, `js/v12.js`, `js/v13.js`, `css/styles.css`, `css/v12.css`, `css/v13.css`.
5. Abrí `index.html` con Live Server, iniciá sesión y hacé clic en **Intelligence** en el menú lateral.
6. Si seguís viendo el menú anterior, verificá que actualizaste el `dashboard.html` correcto y recargá con Ctrl+F5.

## Novedades
- Indicadores de tickets analizados, pares potencialmente similares, similitud alta y recurrencia textual.
- Comparación textual de título y descripción. Muestra pares, palabras compartidas, puntuación porcentual, buscador, filtro de umbral y enlaces a los tickets.
- Detecta tickets que tienen coincidencias con **al menos otros dos tickets** y los presenta como tendencias textuales.
- Seis guías locales de conocimiento para orientar diagnósticos de soporte (cuentas, red/VPN, aplicaciones, hardware, correo e impresión).
- La selección de un ticket permite consultar guías relacionadas y abrir su ficha.

## Qué NO hace
- No hay IA generativa, aprendizaje automático, llamadas a servicios externos ni backend.
- Una puntuación de similitud textual **no garantiza** que dos tickets sean realmente duplicados ni que el incidente se repita en el mismo activo. Usa conjuntos de palabras normalizadas y el índice de Jaccard.
- Los consejos son **orientativos** y no reemplazan verificación técnica.
- No modifica, fusiona, borra ni envía tickets; se limita a analizar los tickets que ya maneja el dashboard.
- Se conserva la persistencia local existente en el navegador; no se agregan claves nuevas ni se migran datos.

## Pruebas sugeridas
1. Abrí Intelligence: deben aparecer los 13 tickets iniciales si no cambiaste la demo.
2. Revisá los pares de tickets con asuntos sobre instalación de software de diseño y comprobá que sean accesibles.
3. Bajá o subí el filtro de similitud; las tarjetas deben cambiar.
4. Elegí un ticket de ERP; debería sugerir la guía sobre cuentas/credenciales.
5. Creá dos tickets con títulos y descripciones similares desde el dashboard y volvé a Intelligence: deberían aparecer si comparten al menos dos términos significativos y su puntuación alcanza el mínimo del filtro.
6. Recargá el navegador: tus tickets deben seguir intactos.

## Integración futura
Al agregar backend, el analizador podría funcionar como servicio independiente, complementarse con embeddings o búsqueda semántica y utilizar IDs de tickets y dispositivos. En esta versión toda la lógica vive en `js/v14.js`.
