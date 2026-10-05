# ADR-0001: Tablero en Cloudflare Worker + D1 con contraseñas por rol

**Fecha**: 2026-10-05
**Estado**: aceptada
**Decidieron**: Rodrigo (pidió la plataforma web), Claude (eligió la plataforma)

## Contexto

El jefe de Rodrigo quiere ver en tiempo real en qué etapa está cada muestra del laboratorio y entender por qué un reporte tarda 7 días hábiles y no 5. Hoy la etapa vive en un Excel personal con 4 casillas sin fecha. Ya existe un prototipo como Artifact de claude.ai, pero el jefe necesita entrar con un enlace propio, sin cuenta de Claude. Rodrigo ya despliega otro proyecto (enlace) en Cloudflare Workers con D1, así que tiene cuenta y experiencia ahí.

## Decisión

Usamos un Cloudflare Worker (Hono) que sirve la página estática y una API REST en `/api/v1`, con la base de datos D1. Cada cambio de etapa se guarda con la hora del servidor en `stage_events`. Hay dos contraseñas: una de edición (Rodrigo) y otra de solo lectura (jefe); la sesión es una cookie firmada con HMAC. El "tiempo real" es una consulta cada 10 s con `ETag`, que responde 304 sin leer las muestras cuando nada cambió.

## Alternativas consideradas

### Seguir con el Artifact de claude.ai
- **Pros**: ya funciona, cero infraestructura.
- **Contras**: el jefe necesita cuenta de Claude; los datos no son exportables ni consultables con SQL.
- **Por qué no**: el objetivo es una plataforma propia del laboratorio.

### Excel compartido en OneDrive / Google Sheets
- **Pros**: familiar.
- **Contras**: sin hora automática por cambio, depende de guardar y compartir; fue descartado por Rodrigo el 2026-10-05.

### Durable Objects con WebSockets para empujar cambios
- **Pros**: actualización instantánea.
- **Contras**: más piezas y costo; para unas decenas de muestras al día 10 s de retraso es suficiente.
- **Por qué no**: se puede añadir después sin cambiar la API.

### Cuentas de usuario o Cloudflare Access
- **Pros**: identidad por persona, auditoría de quién hizo cada cambio.
- **Contras**: más configuración para dos usuarios.
- **Por qué no**: por ahora solo Rodrigo edita. Si se suman más consultores, Access es el siguiente paso.

## Consecuencias

### Positivas
- Despliegue con la misma cuenta de Cloudflare que enlace, dentro del plan gratuito.
- Historial completo de etapas con fecha y hora, base para medir cuánto del tiempo es espera.
- El repositorio es público, pero los datos de clientes viven solo en D1 detrás de contraseña.

### Negativas
- Las contraseñas son compartidas: no se sabe qué persona hizo un cambio, solo que fue alguien con la de edición.
- El jefe ve los cambios con hasta 10 s de retraso.

### Riesgos
- Fuga de una contraseña: se cambia con `wrangler secret put` y, para invalidar sesiones abiertas, también `SESSION_SECRET`.
