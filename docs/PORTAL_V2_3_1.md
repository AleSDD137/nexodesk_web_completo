# NEXODESK V2.3.1 — Portal del Solicitante

## Diagnóstico

El login obtenía el rol real desde el backend, pero todos los usuarios abrían
`dashboard.html` con `currentView = "dashboard"`. El menú ocultaba Assets,
Triage y Usuarios al Solicitante, pero conservaba Dashboard, Tickets, Procesos,
Reportes y Configuración. El botón general abría el formulario administrativo;
sus campos de prioridad y asignación estaban deshabilitados para empleados.

Era una separación incompleta de navegación y experiencia. Esto no demostraba
por sí mismo acceso a tickets ajenos: la API ya filtraba por `requester_email`,
fijaba la identidad del empleado al crear tickets y restringía cambios, Assets,
Triage y administración de usuarios al personal autorizado.

## Decisiones implementadas

- La sesión validada por `/auth/me` y el rol `Solicitante` determinan el
  autoservicio. La preferencia Demo anterior y los atributos HTML no deciden
  los permisos. Demo Local continúa independiente.
- Se reutilizan `dashboard.html`, `portal-ui.js`, sus artículos, los adaptadores
  `modules-data.js` y los estilos oscuros de `modules.css`. No se crea otro
  Portal ni se cambian los renderers de Assets o Triage.
- El empleado entra en `dashboard.html#portal`. Su menú contiene Mi Portal,
  Crear solicitud, Mis solicitudes, Centro de ayuda y Mi cuenta. Mi cuenta
  reutiliza el cambio de contraseña existente, sin configuración global.
- La política central se comprueba al navegar y renderizar. Hashes, parámetros
  `view` y eventos dirigidos a vistas IT vuelven al Portal; la URL se normaliza
  sin bucles ni presentación inicial del panel operativo.
- El formulario API contiene exclusivamente tipo, asunto y descripción.
  Demo conserva nombre y prioridad locales. Ambos comparten tarjetas,
  paneles, ayuda y seguimiento.
- El Portal del empleado consulta sus endpoints, sin cargar el Kanban IT.
  Confirma altas después del POST; un resultado incierto exige una lectura
  antes de reintentar y no crea copias en localStorage.
- El detalle muestra tipo, prioridad, estado, fechas y comentarios públicos.
  Conserva la posibilidad existente de publicar comentarios mediante
  `/tickets/:id/comments`. No agrega auditoría ni notas internas.
- Una sesión vencida vuelve al login real. Cambiar de contraseña conserva
  el mecanismo existente de revocación de otras sesiones.

## Contratos y autorización

| Operación del Solicitante | Resultado |
| --- | --- |
| `POST /api/portal/requests` con tipo/título/descripción | 201; identidad de sesión, prioridad Media, estado Registrado, sin técnico |
| Enviar campos adicionales al alta del Portal | 403, sin insertar ticket |
| Alta administrativa `POST /api/tickets` | 403; reservada al personal IT |
| Modificar ticket, administrar cuentas, activos o Triage | 403 |
| Consultar solicitudes propias | 200; pertenencia comprobada en SQL |
| Consultar/comentar una solicitud ajena o inexistente | 403 para Solicitante, sin confirmar su existencia |
| Endpoint protegido sin sesión | 401 |
| Datos inválidos en campos autorizados | 400 |

`portal-response.ts` define el contrato público de consultas y respuestas de
comentarios del Solicitante. Excluye responsable, correo del solicitante,
origen y propiedades adicionales de comentarios. El detalle del Portal
utiliza el mismo contrato. Los comentarios del modelo actual son públicos;
se excluye defensivamente un registro importado con marca de privacidad,
sin introducir funciones para crear notas internas.

El personal IT conserva el contrato administrativo de tickets, los permisos
de cuentas por rol y las operaciones de Assets y Triage. Los clientes antiguos
que creaban tickets de empleados con `POST /api/tickets` deben utilizar
`POST /api/portal/requests`; el frontend de esta versión ya lo hace.

## Pruebas ejecutadas

Se utilizó Chromium y una instancia PostgreSQL 17 dedicada, con base
`nexodesk_test_v231`. Las migraciones 001–004 se aplicaron únicamente a esa
base. Las cuentas y contraseñas se generaron en memoria. No se usaron `.env`,
registros de la base habitual ni credenciales personales.

| Comprobación | Resultado |
| --- | --- |
| `node --experimental-strip-types --test tests/*.test.cjs` | 16 pruebas aprobadas |
| `cd backend && npm test` | 3 pruebas de contraseñas aprobadas |
| `python -m unittest discover -s tests -p 'test_modules_ui.py'` | 1 prueba aprobada: Assets/Portal, Demo/API, estructura, contraste y responsive |
| `python -m unittest discover -s tests -p 'test_requester_portal.py' -v` con base aislada | 6 pruebas de integración aprobadas |
| Sintaxis de los JavaScript modificados y `git diff --check` | Sin errores |
| `cd backend && npm run check` | Falla por 3 errores preexistentes, reproducidos también en `origin/main` |

La integración ejecutó login real del Solicitante, redirección y recarga,
creación persistida, cierre y nuevo inicio de sesión, exclusión de solicitudes
ajenas, manipulación de campos, respuestas 401/403 y contrato público. También
probó comentarios, Mi cuenta, sesión vencida, recuperación de errores sin
fallback local y navegación por hashes, parámetros y eventos.

Se comprobó atención de un ticket del empleado desde la interfaz del Técnico
L1, alta/edición de activos con vínculo al ticket y persistencia de diagnóstico,
prueba y transferencias L1 → L2 → L3 mediante API. Los accesos L2, L3,
Coordinador y Administrador conservan el panel operativo; el Administrador
conserva la administración de cuentas. Demo y Portal público no llaman a la
API. No se detectaron excepciones JavaScript en los recorridos comprobados.

El Portal y Mi cuenta tienen superficies oscuras y contraste medido de al
menos 4,5:1 en los controles y textos comprobados. Se revisaron anchos de 390,
760 y 1440 px sin desbordamiento de página. Las tablas conservan desplazamiento
horizontal dentro del panel. Las capturas se guardan fuera del checkout.

Los errores TypeScript existentes son:

- `src/password.test.ts:3`: TS5097, importación terminada en `.ts` sin
  `allowImportingTsExtensions`.
- `src/password.ts:15` y `:25`: TS2554, tipado de la variante de `scrypt`
  obtenida mediante `promisify`.

Los tres se reprodujeron ejecutando el compilador sobre una copia temporal
de `origin/main` con las mismas dependencias. No hay errores nuevos reportados
en esta actualización; los archivos de contraseñas no cambian.

## Repetir las pruebas

Instalar las dependencias del backend y Playwright con Chromium. Proveer
`NEXODESK_TEST_DATABASE_URL` apuntando a una base exclusiva de pruebas cuyo
nombre comience por `nexodesk_test_`. El runner rechaza otros nombres, aplica
las migraciones y agrega fixtures sin borrar ni truncar registros. El puerto
3001 debe estar libre; el frontend usa un puerto temporal. Las contraseñas de
fixtures viven en memoria. No compartir ni versionar credenciales de conexión.

```sh
node --experimental-strip-types --test tests/*.test.cjs
cd backend
npm test
npm run check
cd ..
python -m unittest discover -s tests -p 'test_*.py' -v
```

Sin `NEXODESK_TEST_DATABASE_URL`, las seis pruebas de PostgreSQL se omiten
explícitamente: ese resultado no valida persistencia ni autorizaciones reales.
`NEXODESK_SCREENSHOTS` permite guardar capturas, por ejemplo en un directorio
temporal externo al checkout. Las capturas y cachés no se agregan a Git.

## Límites conservados

No hay migraciones nuevas, tablas adicionales, importación automática de Demo
ni cambios sobre datos existentes. La pertenencia continúa utilizando el
correo de la sesión porque ese es el modelo actual; una futura relación por
ID requiere una evolución independiente y revisada. El listado conserva el
límite de 100 solicitudes del endpoint actual. Se muestran estado actual,
fechas y comentarios; no se inventa un historial de transiciones que la base
todavía no guarda. Los artículos siguen siendo estáticos. La instancia
PostgreSQL de la computadora del usuario no fue inspeccionada.
