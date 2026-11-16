# NEXODESK V2.6 — Intelligence

## Implementación

Asistente orientativo para personal IT dentro de la ficha del ticket y en una
vista Intelligence con selector de tickets cargados. Comparte estructura visual
entre API y Demo. Analizar es una acción explícita; abrir una ficha consulta
solo disponibilidad e historial y no realiza llamadas de generación pagas.

El motor local busca hasta cinco antecedentes PostgreSQL mediante índice GIN
de texto técnico sobre título/descripción, ordenados por relevancia e ID.
Recupera diagnósticos documentados de Triage y su estado. Las coincidencias no
demuestran causa, duplicación ni solución: se muestran como antecedentes y
diagnósticos, incluso si el ticket está cerrado. No se inventan resoluciones.
La búsqueda usa un vocabulario técnico acotado; puede omitir casos expresados
con otros términos. Las recomendaciones son hipótesis revisables.

El técnico puede aceptar, descartar o ignorar orientaciones. Aceptar registra
esa decisión con identidad y fecha del servidor; **no modifica el ticket ni
Triage**, no ejecuta comandos y no escala casos. Las decisiones son terminales:
repetirlas produce 409, evitando sobrescribir una revisión concurrente.

## Proveedores y privacidad

`AdviceProvider` separa generación de obtención de datos y validación. OpenAI se
invoca desde el backend con Responses API, esquema JSON y `store:false`.
Configuración:

| Variable del backend | Valor predeterminado |
| --- | --- |
| `OPENAI_API_KEY` | ausente; nunca va al frontend |
| `INTELLIGENCE_EXTERNAL_ENABLED` | ausente/false: solo motor local |
| `INTELLIGENCE_MODEL` | `gpt-6-luna`; puede cambiarse por `gpt-6.1-sol` |
| `INTELLIGENCE_DAILY_TOKEN_BUDGET` | 20000 |
| `INTELLIGENCE_DAILY_REQUEST_LIMIT` | 20 |
| `INTELLIGENCE_USER_HOURLY_LIMIT` | 10 |

Es necesario habilitar explícitamente el proveedor externo y configurar la
clave. Sin ambas condiciones, funciona localmente. Esta decisión evita
generar consumo solo por instalar una variable de entorno compartida.

El proveedor recibe **solo términos técnicos de una lista permitida**, IDs de
antecedentes y si están cerrados. No recibe texto libre, nombres, emails,
solicitantes, responsables, comentarios, notas internas ni diagnósticos crudos.
Las instrucciones maliciosas de tickets no pueden convertirse en instrucciones
del proveedor mediante este contexto. La contrapartida es menor riqueza del
contexto externo. El panel sí muestra los antecedentes documentados al técnico
autorizado a consultarlos, escapando todo HTML.

Se validan tamaño de salida, estructura, listas y referencias: un ID inventado
invalida la respuesta. Ningún texto generado se ejecuta. La salida sigue siendo
una sugerencia no verificada aunque cumpla el esquema.

## Límites y persistencia

007 añade `intelligence_runs` y `intelligence_suggestions`, con PK, FK e índices.
No altera tablas ni filas previas. El ejecutor puede repetir la migración.

Los límites horarios y el presupuesto diario UTC se reservan de forma atómica
bajo un bloqueo de transacción PostgreSQL. Se contabilizan UTF-8 del contexto,
un margen fijo de 4000 tokens para instrucciones/esquema y 600 de salida.
Las reservas se conservan incluso tras fallos o reinicios para no reutilizar
presupuesto de operaciones cuyo costo pudiera ser incierto. No se guarda ni
se confía en el consumo declarado por el cliente. El límite es de tokens y
peticiones, **no un precio monetario garantizado**: revisar los precios del
modelo antes de habilitarlo. Los límites diarios se comparten entre usuarios;
el horario se aplica por usuario autenticado.

Errores de red, cuota, esquema, referencias o presupuesto externo causan una
orientación local identificada como tal. Se registra solamente un código seguro
(`provider_unavailable` o `daily_budget`); no se almacena ni registra el cuerpo
del proveedor, claves, cabeceras o excepciones. El límite horario produce 429.

## API

Todos requieren sesión y rol Administrador, Coordinador o Técnico L1–L3.
Solicitante recibe 403; sin sesión, 401.

| Método y ruta `/api` | Resultado |
| --- | --- |
| GET `/intelligence/status` | proveedor disponible y límites públicos al personal IT |
| GET `/tickets/:id/intelligence` | últimas diez orientaciones y decisiones persistidas |
| POST `/tickets/:id/intelligence` | cuerpo `{}`; generación y persistencia, 201 |
| PUT `/intelligence/suggestions/:id/decision` | `{decision:"accepted"\|"discarded"}`; identidad/fecha del servidor |

Los cuerpos rechazan propiedades adicionales. Un resultado incierto de escritura
bloquea reintentos en el panel y pide reabrir la ficha para consultar su estado.

Demo almacena orientaciones separadas en `nexodesk-demo-intelligence-v26`;
ningún error API activa ese adaptador. Usa antecedentes de tickets locales
identificados como Demo, sin envío a OpenAI.

## Pruebas

Ejecutado: `node --experimental-strip-types --test src/intelligence-engine.test.ts`
(desde `backend`), **5 aprobadas**: determinismo local, ausencia de texto/secretos
en contexto, proveedor intercambiable simulado, referencias inventadas, contrato
Responses, modelo configurable, cuota, JSON inválido y fallo de red.
`npm run check` ejecutado correctamente durante el desarrollo de esta fase.

`tests/test_intelligence_api.py` agrega pruebas PostgreSQL de referencias,
aceptación/reingreso sin mutación del ticket, permisos y límite horario durable.
**Ejecutadas y aprobadas: 3/3**, sobre PostgreSQL aislado `nexodesk_test_v29`.
La ejecución de `npm test` del bloque en ese punto aprobó 14 pruebas (incluyendo
las cinco de Intelligence, cinco de contraseñas y cuatro de reloj SLA).
Los resultados adicionales de integración y navegador se registran en
`NEXODESK_INTEGRATION_TEST_PLAN.md` al ejecutar la batería final.

No se llamó una API de IA paga ni se comprobó disponibilidad real de los nombres
de modelos solicitados. El proveedor se validó con respuestas simuladas; antes
de habilitar consumo real, verificar acceso al modelo y presupuesto en la cuenta
OpenAI. No se tocó la base personal del estudiante.
