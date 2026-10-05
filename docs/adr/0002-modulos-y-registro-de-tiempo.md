# ADR-0002: Dos módulos (cotizaciones y muestras) y registro de tiempo

**Fecha**: 2026-10-05
**Estado**: aceptada

## Contexto
Rodrigo pidió separar el trabajo administrativo (desde la cotización hasta entregar probetas al consultor) de la evaluación de muestras, poder vincular ambos, ver qué tareas dependen de él y cuáles de otros, y una gráfica de productividad con el tiempo invertido en cada actividad. El VoBo del cliente ocurre antes de recibir probetas.

## Decisión
- Nueva tabla `quotes` con su historial de estados; `samples.quote_id` las vincula.
- Las etapas de muestra se reordenan: VoBo → maquinado → probetas listas (administrativo) y recibido por consultor → … → entregado (evaluación).
- Cada muestra tiene `admin_by_me` y `test_by_me` para saber qué partes le tocan a Rodrigo.
- Tabla `activities` con bloques de tiempo (inicio, fin, tipo, vínculo opcional); fin nulo = cronómetro en curso, solo uno a la vez.
- El acondicionamiento guarda inicio y fin; se llenan solos al entrar y salir de esa etapa y se pueden corregir. El límite de 1 a 7 días para flamabilidad es un aviso, no un bloqueo.
- Un solo endpoint `/board` entrega todo para que la página siga consultando cada 10 s con `ETag`.

## Alternativas consideradas
- **Calcular el tiempo solo con los cambios de etapa**: no mide el trabajo real (una muestra puede pasar días esperando al cliente). Se descartó.
- **Bloquear acondicionamientos de más de 7 días**: impediría registrar lo que pasó en realidad. Se prefirió avisar.

## Consecuencias
- La gráfica de productividad depende de que Rodrigo use el cronómetro o capture bloques pasados.
- La migración 0002 es necesaria antes de usar la nueva página.
