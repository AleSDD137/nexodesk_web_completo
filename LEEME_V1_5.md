# NEXODESK V1.5 — Triage L1/L2/L3

**Requisito:** tener instalada y funcionando la V1.4. Este ZIP es un **parche incremental**: no contiene todos los archivos del proyecto.

## Instalación en Visual Studio Code

1. Hacé una copia de seguridad de tu carpeta NEXODESK V1.4.
2. Copiá `dashboard.html` y `js/app.js` del parche a las ubicaciones respectivas de tu proyecto y aceptá reemplazarlos.
3. Copiá los archivos **nuevos** `js/v15.js` y `css/v15.css`.
4. No cambies `index.html`, `login.html`, `portal.html` ni los archivos anteriores de V1.1–V1.4.
5. Abrí `index.html` con Live Server, ingresá al dashboard y elegí **Triage L1–L3** en el menú.
6. Si no aparece, comprobá que abriste la carpeta correcta y actualizá con Ctrl+F5.

## Funcionalidades

- Bandeja de tickets con búsqueda y filtros (abiertos, todos, sin triage).
- Clasificación por categoría, impacto y urgencia. Sugerencia de prioridad calculada en una matriz simple; **solo modifica el ticket si se marca expresamente** la casilla correspondiente.
- Registro de diagnóstico, pruebas realizadas y bitácora cronológica local.
- Sugerencias orientativas mediante reglas de coincidencia de texto (VPN, accesos, aplicaciones, hardware, correo e impresión), alineadas con Intelligence V1.4, pero implementadas localmente en V1.5.
- Transferencia manual a L1, L2 o L3; requiere diagnóstico guardado, una prueba registrada, motivo y próximo paso. Puede elegirse un técnico activo de demostración; si se elige, se actualiza el responsable del ticket.
- El nivel del ticket y la bitácora se almacenan en la clave `nexodesk-triage-v15` de localStorage, **sin alterar** la estructura de tickets de versiones anteriores. Las prioridades y asignaciones confirmadas se guardan usando la función existente del dashboard.

## Prueba rápida

1. Entrá a Triage y seleccioná un ticket de ERP o instalación de software.
2. Definí categoría, impacto y urgencia, completá el diagnóstico y una prueba realizada, y pulsá **Guardar clasificación y diagnóstico**.
3. Consultá las sugerencias de apoyo (las de ERP deberían mencionar cuentas/accesos).
4. Elegí destino L2, escribí por qué escalás y qué falta hacer, y pulsá **Confirmar transferencia**.
5. Observá la bitácora y el indicador **En L2 / L3**.
6. Abrí la ficha del ticket: si asignaste otro técnico o aplicaste la prioridad sugerida, esos campos estarán actualizados.
7. Recargá la página para comprobar la persistencia local.

## Límites importantes

- Es un **frontend demo** sin autenticación/roles reales ni control de permisos. No uses datos corporativos sensibles.
- No transfiere tickets a ninguna cola real ni envía notificaciones: registra una transferencia local que podrá integrarse con backend posteriormente.
- Los nombres L1, L2 y L3 son niveles de destino, no usuarios técnicos: el directorio demo no tiene pertenencia real a niveles.
- Las sugerencias son coincidencias de palabras, **no IA generativa** ni recomendaciones verificadas.
- Al pulsar «Restablecer demo» se reinician los tickets del dashboard, pero **no** la bitácora de Triage. Para reiniciar esta última, eliminá solo la clave `nexodesk-triage-v15` de localStorage en herramientas de desarrollador. Si reutilizás IDs de tickets, también podrían reutilizarse registros de Triage anteriores.

## Archivos de este parche

- `dashboard.html` (modificado)
- `js/app.js` (modificado)
- `js/v15.js` (nuevo)
- `css/v15.css` (nuevo)
- `LEEME_V1_5.md` (nuevo)
