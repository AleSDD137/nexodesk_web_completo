# NEXODESK V1.3 · Mapa de Relaciones IT

**Requisito:** NEXODESK V1.2 instalado y funcionando. Esta entrega es un parche, **no** el proyecto completo.

## Instalación

1. Hacé una copia de seguridad del proyecto V1.2 (y, si querés conservar los datos de demo, exportalos previamente).
2. Copiá `dashboard.html`, `js/app.js`, `js/v13.js` y `css/v13.css` a las rutas equivalentes en tu proyecto, reemplazando únicamente los dos archivos existentes mencionados.
3. No cambies `index.html`, `login.html`, `portal.html`, `js/v12.js`, `css/styles.css` ni `css/v12.css`.
4. Abrí `index.html` con Live Server en VS Code, iniciá sesión de demostración y elegí **Relaciones IT** en el menú.

## Funciones

- Mapa SVG navegable de personas, activos y tickets.
- Filtros por búsqueda, clase de entidad y tickets cerrados.
- Inspector con relaciones y acceso a los detalles del ticket.
- Vínculos explícitos entre equipos y múltiples tickets; podés agregar y quitar vínculos adicionales desde el inspector.
- Resumen de equipos con **dos o más tickets explícitamente vinculados**.
- Los vínculos originales (`ticketId`) se administran desde **Assets**; no se eliminan desde este mapa.

## Datos y compatibilidad

- Lee tickets de `nexodesk-demo-tickets-v1`, usuarios de `nexodesk-demo-users-v1` y activos de `nexodesk-demo-assets-v12` a través de los módulos existentes.
- Solo los **vínculos adicionales** se guardan en `localStorage` bajo `nexodesk-demo-asset-links-v13`.
- No cambia ni borra los tickets, usuarios ni activos previos.
- Los nodos de personas relacionan nombres que coinciden exactamente tras normalización de espacios y mayúsculas. Eso **no verifica identidad real**.
- Todos los datos permanecen dentro del navegador/origen actual. No hay backend, seguridad de producción ni sincronización entre dispositivos.

## Prueba sugerida

1. Entrá a Relaciones IT y seleccioná **HP ProBook 450** (activo demo `NX-A001`).
2. En el inspector, vinculá un segundo ticket distinto de `#10301`.
3. Comprobá que sube a **1** el indicador de equipos con 2+ tickets y aparece en «Dispositivos con incidentes repetidos».
4. Abrí un ticket desde su nodo y verificá que aparece el detalle habitual.
5. Recargá la página: el vínculo agregado tiene que permanecer.
6. Quitá el vínculo adicional: el contador debería volver a cero (si no agregaste otros).

## Próximos pasos técnicos

Al integrar backend, sustituir las coincidencias por nombre por IDs estables y almacenar la relación `asset_ticket` en una tabla N:M. El mapa ya representa esta futura relación conceptual.
