# Elite · Tablero de muestras

Página web donde se ve **en tiempo real en qué etapa está cada muestra** del laboratorio (flamabilidad, FTIR, color y brillo), con la fecha y hora de cada cambio de etapa.

- **Rodrigo** (contraseña de edición) da de alta muestras y las pasa de etapa desde el celular o la computadora.
- **El jefe** (contraseña de lectura) abre el mismo enlace y ve el tablero; se actualiza solo cada 10 segundos.

Etapas: Recibido → En VoBo → En maquinado → Probetas listas → Acondicionando → En prueba → Elaborando reporte → En revisión → Entregado.

Las tarjetas se ponen **ámbar** a 2 días hábiles de la fecha compromiso y **rojas** cuando se pasan. Los días hábiles excluyen fines de semana y los feriados de ley (art. 74 LFT). Abajo del tablero se muestra el tiempo promedio que las muestras pasan en cada etapa.

## Cómo está hecho

| Pieza | Dónde |
|---|---|
| API REST (`/api/v1`) en Cloudflare Workers con Hono | `src/` |
| Base de datos D1 (SQLite) | `migrations/` |
| Página (HTML + JS sin compilación) | `public/` |
| Pruebas de API y de días hábiles (Vitest dentro del runtime de Workers) | `test/` |
| Pruebas de punta a punta (Playwright, escritorio y celular) | `e2e/` |
| Decisiones de arquitectura | `docs/adr/` |

### API

| Método | Ruta | Quién |
|---|---|---|
| `POST` | `/api/v1/session` `{password}` | todos (inicia sesión) |
| `GET` / `DELETE` | `/api/v1/session` | con sesión |
| `GET` | `/api/v1/stages` | con sesión |
| `GET` | `/api/v1/samples` (con `ETag`, responde 304 si nada cambió) | con sesión |
| `GET` | `/api/v1/samples/:id` | con sesión |
| `POST` | `/api/v1/samples` | edición |
| `PATCH` / `DELETE` | `/api/v1/samples/:id` | edición |
| `POST` | `/api/v1/samples/:id/stage-changes` `{stage, note?}` | edición |

La hora de cada cambio de etapa la pone el servidor, no el navegador.

## Ponerlo en línea (una sola vez)

Se usa la misma cuenta de Cloudflare del proyecto *enlace*.

```bash
npm install
npx wrangler login                      # abre el navegador para autorizar
npx wrangler d1 create elite            # copia el database_id que imprime…
#   …y pégalo en wrangler.jsonc, en "database_id"
npm run db:migrate:remote               # crea las tablas
npx wrangler secret put EDITOR_PASSWORD # tu contraseña (edición)
npx wrangler secret put VIEWER_PASSWORD # la del jefe (solo lectura)
npx wrangler secret put SESSION_SECRET  # texto aleatorio de 32+ caracteres
npm run deploy                          # imprime la URL https://elite.<tu-cuenta>.workers.dev
```

Para `SESSION_SECRET` puedes generar uno con `openssl rand -base64 48`.

Para cargar muestras existentes desde un archivo SQL:

```bash
npx wrangler d1 execute elite --remote --file=ruta/al/archivo.sql
```

Los datos de clientes **no** se guardan en este repositorio (es público): viven solo en D1.

### Cambiar una contraseña

`npx wrangler secret put VIEWER_PASSWORD` (o la de edición). Para cerrar todas las sesiones abiertas, cambia también `SESSION_SECRET`.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars          # contraseñas locales
npm run db:migrate:local
npm run dev                             # http://localhost:8787
```

Pruebas:

```bash
npm run check                           # tipos + pruebas de API
npm run test:e2e                        # navegador (escritorio y celular)
```

Si ya tienes Chromium instalado y no quieres que Playwright descargue otro, usa `CHROMIUM_PATH=/ruta/a/chrome npm run test:e2e`.
