# NEXODESK V2.6–V2.9 — Integración y aceptación

## Base y alcance

Base: `main` con V2.5 integrada, commit `69d02c9`. La inspección confirmó rutas
PostgreSQL para autenticación, tickets, Portal, Assets, Triage, auditoría,
Pulse y Relaciones IT. Intelligence era heurístico de navegador y los reportes
calculaban una lista local; no existían SLA ni importación masiva persistentes.

La batería inicial aprobó 51 pruebas: 16 Node de contratos/adaptadores, 5 de
contraseñas y 30 Python de API/PostgreSQL/navegador. `npm run check` pasó.
No se accedió al PostgreSQL personal del estudiante. El desarrollo utiliza
PostgreSQL 17 en un contenedor temporal y una base `nexodesk_test_*`.

## Estrategia

- Commits por fase y un único PR, sin merge automático.
- Pruebas determinísticas y proveedor IA simulado; la suite no paga una API.
- PostgreSQL real aislado para persistencia, permisos, integridad, transacciones
  y repetición de migraciones. Los fixtures rechazan nombres de base que no
  comiencen con `nexodesk_test_`.
- Chromium para flujos API/Demo, recarga, responsive, foco, errores y contraste.
- GitHub Actions ejecuta las verificaciones en push y PR, con una instancia
  PostgreSQL efímera. Sus resultados remotos se distinguen de los ejecutados
  localmente por Codex.

## Ejecución automatizada

```sh
cd backend
npm ci
npm run check
npm test
cd ..
node --test tests/*.test.cjs
python -m pip install -r tests/requirements-browser.txt
python -m playwright install chromium
python -m unittest discover -s tests -p 'test_*.py' -v
```

Para Python, configurar `NEXODESK_TEST_DATABASE_URL` con una base aislada y
dejar libre el puerto 3001. `NEXODESK_SCREENSHOTS` permite guardar capturas
fuera del repositorio. Si Chromium es del sistema, usar `CHROMIUM_PATH`.
No utilizar la URL personal para esta suite. Desactivar el proveedor externo
con `INTELLIGENCE_EXTERNAL_ENABLED=false` durante pruebas de integración.

## Una sola actualización local al finalizar

1. Integrar el PR revisado y actualizar `main` en VS Code. Guardar antes los
   cambios locales pendientes para evitar sobrescribir trabajo propio.
2. Crear un respaldo de PostgreSQL mediante la herramienta habitual.
3. Revisar la conexión privada del backend; no publicarla ni pegarla en chats.
4. Desde `backend`, ejecutar `npm ci`, `npm run check` y `npm run db:migrate`.
   El ejecutor aplica incrementalmente las migraciones; no elimina tablas.
5. Reiniciar el backend con `npm start` y abrir el frontend mediante el servidor
   HTTP habitual. No abrir `dashboard.html` con `file://`.
6. Inicialmente mantener Intelligence local. Configurar proveedor, presupuestos
   y políticas SLA según los documentos de cada versión antes de habilitarlos.

## Única sesión de aceptación manual del estudiante

Esta lista verifica el entorno personal después del despliegue; no sustituye
las pruebas automáticas ni implica que ya se haya ejecutado allí.

1. Solicitante: iniciar sesión, crear solicitud, recargar y reingresar; ver
   únicamente solicitudes propias, sin notas internas ni módulos IT.
2. Técnico: abrir la solicitud, analizar con Intelligence local, revisar
   antecedentes y aceptar/descartar una sugerencia. Comprobar que no cambia
   automáticamente estado, prioridad, responsable ni nivel de Triage.
3. Registrar una respuesta pública, diagnóstico, prueba y nota interna.
   Verificar persistencia y privacidad desde la cuenta Solicitante.
4. Coordinador: revisar una política SLA con zona horaria y días laborales,
   comprobar plazos/alertas y su historial; repetir comprobación sin duplicados.
5. Inventario: previsualizar CSV de prueba, revisar errores y duplicados,
   confirmar altas y una actualización explícita. Recargar y consultar historial
   de responsable, ubicación y estado. Confirmar que se conservan vínculos.
6. Exportar inventario y revisar filas/columnas en un programa compatible con
   CSV. No es necesario habilitar macros ni importar archivos XLSX.
7. Reportes: aplicar período y filtros; comparar un conjunto conocido con
   tickets reales, revisar muestras/desconocidos y exportar CSV.
8. Pulse y Relaciones: comprobar totales, feed, vínculos principales/adicionales
   y asociación explícita a usuario. Confirmar que las versiones previas siguen
   operativas.
9. Demo: cambiar a origen local autorizado y comprobar que las operaciones
   no cambian PostgreSQL. Volver a API y confirmar sus datos originales.
10. Revisar escritorio y móvil, teclado y consola. Anotar problemas con pasos,
    rol, módulo y resultado esperado, sin incluir credenciales.

## Registro de resultados finales

Ejecución final aprobada: **105 pruebas**, sin omisiones:

| Batería | Resultado |
| --- | --- |
| TypeScript `npm run check` | Sin errores |
| Backend `npm test` | 20/20 |
| Adaptadores y contratos Node | 23/23 |
| API, PostgreSQL y Chromium Python | 62/62, 128,339 s |

La batería Python completa se repitió después de actualizar los fixtures antiguos
para las consultas de Intelligence. Se ejecutó sobre una base nueva y vacía
`nexodesk_test_v29_acceptance`, PostgreSQL 17 aislado; no contra una base personal.
Se verificaron las migraciones, permisos, rollbacks, persistencia, aislamiento,
calendarios/DST, importación, métricas y regresiones. Los cuatro módulos tienen
recorridos API/Demo a 390, 768 y 1440 px, contraste, teclado y capturas externas.
El commit de V2.6 también se comprobó por separado en un checkout temporal con
TypeScript y sus 10 pruebas unitarias disponibles en esa fase.

La llamada al proveedor OpenAI real, la ejecución remota de Actions y la
aceptación contra PostgreSQL personal requieren verificaciones independientes.

## Alcance entregado y límites explícitos

- V2.6: sugerencias locales persistentes, referencias reales, decisiones humanas
  y proveedor OpenAI configurable con presupuestos. Proveedor real no probado;
  se usaron respuestas simuladas sin consumo pago. El presupuesto limita tokens
  reservados y solicitudes, no representa una factura monetaria del proveedor.
- V2.7: políticas y calendarios laborales, hitos transaccionales, alertas,
  reconocimiento e idempotencia. El worker es optativo y apagado por defecto.
  Las reglas proponen escalamientos; no ejecutan transferencias ni cambios de
  prioridad/responsable. Esas acciones siguen siendo decisiones humanas.
- V2.8: CSV UTF-8 con vista previa y confirmación, actualización explícita,
  responsables/vínculos preservados, historial y exportación. Excel requiere
  guardar como CSV; no se agregó un lector XLSX. Límites: 200 filas/24 KB por
  importación y 10.000 activos por exportación, con filtros para volúmenes mayores.
- V2.9: métricas SQL, intervenciones documentadas por ID, filtros, gráficos,
  CSV e impresión/guardar PDF desde el navegador. No hay generador PDF del
  servidor. Fechas o tiempos históricos desconocidos no se reconstruyen.

Las migraciones nuevas son 007 (Intelligence), 008 (SLA) y 009 (historial de
activos). No hay tablas nuevas para reportes. El modelo actualizado se encuentra
en `docs/modelo-relacional-v2-9.mmd`. Las pruebas incluyen upgrade desde V2.5
con datos, comparación de filas anteriores y repetición de las nueve migraciones.
No se crean movimientos ni cumplimiento SLA históricos ficticios.

También se corrigieron dos fixtures de regresión: selección explícita de ticket
por ID en Relaciones, y respuestas de lectura de Intelligence en las pruebas
visuales del historial. Se conservan sus aserciones de seguridad y accesibilidad.

GitHub Actions quedó configurado en `.github/workflows/verify.yml`; su ejecución
remota no se considera comprobada desde este entorno. Las capturas se guardan
fuera de Git. Los Word académicos no fueron modificados.
