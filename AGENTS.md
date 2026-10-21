# NEXODESK — Instrucciones para Codex

## Objetivo

Continuar el desarrollo de NEXODESK respetando su arquitectura existente y las funcionalidades ya implementadas.

## Contexto

- Proyecto desarrollado en Windows con Visual Studio Code.
- Backend con Node.js y PostgreSQL.
- Existe un frontend que debe mantenerse compatible con el backend.
- El desarrollo sigue un proceso incremental.
- Los módulos conocidos incluyen Assets, Triage, Portal, Pulse, Relaciones IT e Intelligence.
- Antes de intervenir, verificar cuáles módulos existen realmente y su estado de implementación.

## Reglas de trabajo

1. Leer y comprender el código existente antes de modificarlo.
2. No reemplazar funcionalidades completas sin justificación.
3. Preferir cambios pequeños, incrementales y fáciles de revisar.
4. Mantener la compatibilidad entre frontend, backend y base de datos.
5. No modificar ni revelar contraseñas, tokens o secretos.
6. Nunca eliminar información de PostgreSQL sin autorización explícita.
7. No ejecutar migraciones destructivas ni comandos de borrado sin autorización.
8. Explicar qué archivos se modificaron y por qué.
9. Verificar los cambios mediante pruebas cuando sea posible.
10. Documentar los errores pendientes y los pasos necesarios para solucionarlos.
11. No asumir que una funcionalidad está terminada sin verificarla.
12. Entregar un resumen claro de cada modificación.

## Forma de trabajar

- Primero realizar un diagnóstico.
- Después proponer los cambios.
- Implementar únicamente los cambios autorizados.
- Mantener un registro de las decisiones técnicas importantes.
- Priorizar la estabilidad y continuidad del proyecto.