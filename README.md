# Elite · Laboratorio

Página web donde se ve **en tiempo real en qué etapa está cada muestra** del laboratorio, desde la cotización hasta el reporte entregado, y cuánto tiempo invierte Rodrigo en cada actividad.

- **Rodrigo** (contraseña de edición) da de alta cotizaciones y muestras, las pasa de etapa y registra su tiempo con un cronómetro.
- **El jefe** (contraseña de lectura) abre el mismo enlace y ve todo; se actualiza solo cada 10 segundos.

Tiene tres pestañas:

| Pestaña | Qué muestra |
|---|---|
| **Muestras** | Tablero por etapa. Parte administrativa: En VoBo → En maquinado → Probetas listas. Evaluación: Recibido por consultor → Acondicionando → En prueba → Elaborando reporte → En revisión → Entregado. Cada muestra dice si le toca a Rodrigo o espera a otros (cliente, taller, consultor). |
| **Cotizaciones** | En elaboración → Enviada al cliente → En seguimiento → Comprada / Perdida. Cada cotización se vincula con sus muestras. |
| **Mi productividad** | Carga actual, horas por día (administrativo / evaluación / otro), tiempo por actividad y la línea del tiempo de todo el trabajo. |

Las tarjetas se ponen **ámbar** a 2 días hábiles de la fecha compromiso y **rojas** cuando se pasan. Los días hábiles excluyen fines de semana y los feriados de ley (art. 74 LFT). El acondicionamiento guarda inicio y fin con hora; para Flamabilidad Horizontal avisa si pasa de 7 días. La lista de pruebas está en `src/catalog.ts`.

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
| `GET` | `/api/v1/catalog` (etapas, pruebas, estados, actividades) | con sesión |
| `GET` | `/api/v1/board` (todo junto, con `ETag`; 304 si nada cambió) | con sesión |
| `GET` | `/api/v1/samples`, `/api/v1/samples/:id`, `/api/v1/quotes/:id` | con sesión |
| `POST` | `/api/v1/samples`, `/api/v1/quotes`, `/api/v1/activities` | edición |
| `PATCH` / `DELETE` | `/api/v1/samples/:id`, `/api/v1/quotes/:id`, `/api/v1/activities/:id` | edición |
| `POST` | `/api/v1/samples/:id/stage-changes` `{stage, note?}` | edición |
| `POST` | `/api/v1/quotes/:id/status-changes` `{status, note?}` | edición |

Una actividad sin `endedAt` es el cronómetro en curso; iniciar otra detiene la anterior.

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

### Actualizar a una versión nueva

```bash
git pull
npm install
npm run db:migrate:remote   # aplica solo las migraciones nuevas
npm run deploy
```

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
