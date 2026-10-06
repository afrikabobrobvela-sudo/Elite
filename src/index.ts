import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import { COOKIE_NAME, SESSION_TTL_SECONDS, roleForPassword, signSession, verifySession, type Role } from "./auth";
import * as db from "./db";
import * as schemas from "./schemas";
import * as catalog from "./catalog";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EDITOR_PASSWORD: string;
  VIEWER_PASSWORD: string;
  SESSION_SECRET: string;
}

const MIN_PASSWORD_LENGTH = 12;

/** Clave para limitar intentos: la IPv4 completa o el prefijo /64 de una IPv6 (una sola casa u oficina). */
export function clientKey(ip: string | undefined): string {
  if (!ip) return "desconocida";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

type App = { Bindings: Env; Variables: { role: Role } };

const app = new Hono<App>().basePath("/api/v1");

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 422 | 429 | 500, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details ? { details } : {}) } }, status);

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "invalid_json", "El cuerpo de la petición no es JSON válido");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(
      c,
      422,
      "validation_error",
      "Datos inválidos",
      parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}

app.onError((err, c) => {
  console.error(err);
  return fail(c, 500, "internal_error", "Error interno");
});

app.use("*", async (c, next) => {
  const { SESSION_SECRET, EDITOR_PASSWORD, VIEWER_PASSWORD } = c.env;
  if (
    (SESSION_SECRET?.length ?? 0) < 32 ||
    (EDITOR_PASSWORD?.length ?? 0) < MIN_PASSWORD_LENGTH ||
    (VIEWER_PASSWORD?.length ?? 0) < MIN_PASSWORD_LENGTH ||
    EDITOR_PASSWORD === VIEWER_PASSWORD
  ) {
    return fail(
      c,
      500,
      "not_configured",
      "Configura EDITOR_PASSWORD y VIEWER_PASSWORD (distintas, de 12+ caracteres) y SESSION_SECRET (32+ caracteres)",
    );
  }
  // Defensa CSRF extra a la cookie SameSite=Strict: las escrituras deben venir de esta misma página.
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return fail(c, 403, "bad_origin", "Origen no permitido");
  }
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

// --- Sesión -----------------------------------------------------------------

app.post("/session", async (c) => {
  const ip = clientKey(c.req.header("CF-Connecting-IP"));
  const now = Date.now();
  if ((await db.recentLoginFailures(c.env.DB, ip, now)) >= db.MAX_LOGIN_FAILURES) {
    c.header("Retry-After", "900");
    return fail(c, 429, "too_many_attempts", "Demasiados intentos. Espera 15 minutos.");
  }
  const body = await parseBody(c, schemas.login);
  if (body instanceof Response) return body;
  const role = await roleForPassword(body.password, c.env);
  if (!role) {
    await db.recordLoginFailure(c.env.DB, ip, now);
    return fail(c, 401, "bad_password", "Contraseña incorrecta");
  }
  setCookie(c, COOKIE_NAME, await signSession(role, c.env.SESSION_SECRET, now), {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ data: { role } });
});

app.delete("/session", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: true });
  return c.body(null, 204);
});

// El catálogo no tiene datos del laboratorio; el modo demo lo usa sin sesión.
app.get("/catalog", (c) =>
  c.json({
    data: {
      stages: catalog.STAGES,
      quoteStatuses: catalog.QUOTE_STATUSES,
      tests: catalog.TESTS,
      conditioningLimits: catalog.CONDITIONING_LIMITS,
      activityTypes: catalog.ACTIVITY_TYPES,
      activityGroups: catalog.ACTIVITY_GROUPS,
      followUpDays: catalog.FOLLOW_UP_DAYS,
    },
  }),
);

// Todo lo de abajo requiere sesión.
app.use("*", async (c, next) => {
  const role = await verifySession(getCookie(c, COOKIE_NAME), c.env.SESSION_SECRET);
  if (!role) return fail(c, 401, "unauthenticated", "Inicia sesión");
  c.set("role", role);
  await next();
});

const editorOnly = async (c: Context<App>, next: Next) => {
  if (c.get("role") !== "editor") return fail(c, 403, "read_only", "Tu acceso es de solo lectura");
  await next();
};

app.get("/session", (c) => c.json({ data: { role: c.get("role") } }));


/** Responde 304 si el tablero no cambió desde la versión que trae la página. */
async function notModified(c: Context<App>): Promise<Response | string> {
  const etag = `W/"${await db.boardVersion(c.env.DB)}"`;
  c.header("ETag", etag);
  return c.req.header("If-None-Match") === etag ? c.body(null, 304) : etag;
}

const ACTIVITY_WINDOW_DAYS = 400;

// Una sola consulta con todo: la página la repite cada pocos segundos.
app.get("/board", async (c) => {
  const nm = await notModified(c);
  if (nm instanceof Response) return nm;
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 864e5).toISOString();
  return c.json({ data: await db.loadBoard(c.env.DB, since), meta: { serverTime: new Date().toISOString() } });
});

const idParam = (c: Context) => c.req.param("id") ?? "";
const now = () => new Date().toISOString();

/** Verifica que un fin no quede antes de su inicio. */
function endBeforeStart(start: string | null | undefined, end: string | null | undefined): boolean {
  return Boolean(start && end && Date.parse(end) < Date.parse(start));
}

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Valida la fecha de un cambio de etapa o estado: no puede ser futura ni quedar fuera
 * de orden respecto a los renglones vecinos del historial. Devuelve el mensaje de error o null.
 */
function badEventDate(at: string, prev?: string | null, next?: string | null): string | null {
  const t = Date.parse(at);
  if (t > Date.now() + FUTURE_TOLERANCE_MS) return "La fecha no puede ser futura";
  if (prev && t < Date.parse(prev)) return "La fecha es anterior al cambio previo del historial";
  if (next && t > Date.parse(next)) return "La fecha es posterior al cambio siguiente del historial";
  return null;
}

const lastAt = (history: { at: string | null }[]) =>
  history.reduce<string | null>((m, e) => (e.at && (!m || e.at > m) ? e.at : m), null);

/** Renglones vecinos (con fecha) del renglón `eventId`, en el orden en que se capturaron. */
function neighbours<E extends { id: number; at: string | null }>(history: E[], eventId: number) {
  const i = history.findIndex((e) => e.id === eventId);
  if (i < 0) return null;
  const before = history.slice(0, i).reverse().find((e) => e.at)?.at ?? null;
  const after = history.slice(i + 1).find((e) => e.at)?.at ?? null;
  return { before, after, isLast: i === history.length - 1 };
}

const eventIdParam = (c: Context) => Number(c.req.param("eventId"));

// --- Muestras ---------------------------------------------------------------

app.get("/samples", async (c) => {
  const nm = await notModified(c);
  if (nm instanceof Response) return nm;
  return c.json({ data: await db.listSamples(c.env.DB) });
});

app.get("/samples/:id", async (c) => {
  const sample = await db.getSample(c.env.DB, idParam(c));
  return sample ? c.json({ data: sample }) : fail(c, 404, "not_found", "Muestra no encontrada");
});

app.post("/samples", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.createSample);
  if (body instanceof Response) return body;
  const { stage, note, at, ...fields } = body;
  if (endBeforeStart(fields.conditioningStart, fields.conditioningEnd)) {
    return fail(c, 422, "validation_error", "El fin del acondicionamiento es anterior a su inicio");
  }
  const t = now();
  const bad = at && badEventDate(at);
  if (bad) return fail(c, 422, "validation_error", bad);
  const id = await db.createSample(c.env.DB, fields, stage, note ?? "", at ?? t, t);
  c.header("Location", `/api/v1/samples/${id}`);
  return c.json({ data: await db.getSample(c.env.DB, id) }, 201);
});

app.patch("/samples/:id", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.updateSample);
  if (body instanceof Response) return body;
  const current = await db.getSample(c.env.DB, idParam(c));
  if (!current) return fail(c, 404, "not_found", "Muestra no encontrada");
  const start = body.conditioningStart !== undefined ? body.conditioningStart : current.conditioningStart;
  const end = body.conditioningEnd !== undefined ? body.conditioningEnd : current.conditioningEnd;
  if (endBeforeStart(start, end)) {
    return fail(c, 422, "validation_error", "El fin del acondicionamiento es anterior a su inicio");
  }
  await db.updateSample(c.env.DB, current.id, body, now());
  return c.json({ data: await db.getSample(c.env.DB, current.id) });
});

app.delete("/samples/:id", editorOnly, async (c) => {
  if (!(await db.deleteSample(c.env.DB, idParam(c)))) return fail(c, 404, "not_found", "Muestra no encontrada");
  return c.body(null, 204);
});

app.post("/samples/:id/stage-changes", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.stageChange);
  if (body instanceof Response) return body;
  const current = await db.getSample(c.env.DB, idParam(c));
  if (!current) return fail(c, 404, "not_found", "Muestra no encontrada");
  const t = now();
  const at = body.at ?? t;
  const bad = badEventDate(at, lastAt(current.history));
  if (bad) return fail(c, 422, "validation_error", bad);
  await db.changeStage(c.env.DB, current.id, body.stage, body.note ?? "", at, t);
  return c.json({ data: await db.getSample(c.env.DB, current.id) }, 201);
});

app.patch("/samples/:id/events/:eventId", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.eventEdit);
  if (body instanceof Response) return body;
  const current = await db.getSample(c.env.DB, idParam(c));
  const near = current && neighbours(current.history, eventIdParam(c));
  if (!current || !near) return fail(c, 404, "not_found", "Cambio de etapa no encontrado");
  const bad = body.at && badEventDate(body.at, near.before, near.after);
  if (bad) return fail(c, 422, "validation_error", bad);
  await db.editStageEvent(c.env.DB, current.id, eventIdParam(c), body, near.isLast, current.stage, now());
  return c.json({ data: await db.getSample(c.env.DB, current.id) });
});

// --- Cotizaciones -----------------------------------------------------------

app.get("/quotes/:id", async (c) => {
  const quote = await db.getQuote(c.env.DB, idParam(c));
  return quote ? c.json({ data: quote }) : fail(c, 404, "not_found", "Cotización no encontrada");
});

app.post("/quotes", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.createQuote);
  if (body instanceof Response) return body;
  const { status, note, at, ...fields } = body;
  const t = now();
  const bad = at && badEventDate(at);
  if (bad) return fail(c, 422, "validation_error", bad);
  const id = await db.createQuote(c.env.DB, fields, status, note ?? "", at ?? t, t);
  c.header("Location", `/api/v1/quotes/${id}`);
  return c.json({ data: await db.getQuote(c.env.DB, id) }, 201);
});

app.patch("/quotes/:id", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.updateQuote);
  if (body instanceof Response) return body;
  const id = idParam(c);
  if (!(await db.updateQuote(c.env.DB, id, body, now()))) return fail(c, 404, "not_found", "Cotización no encontrada");
  return c.json({ data: await db.getQuote(c.env.DB, id) });
});

app.delete("/quotes/:id", editorOnly, async (c) => {
  if (!(await db.deleteQuote(c.env.DB, idParam(c)))) return fail(c, 404, "not_found", "Cotización no encontrada");
  return c.body(null, 204);
});

app.post("/quotes/:id/status-changes", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.quoteStatusChange);
  if (body instanceof Response) return body;
  const current = await db.getQuote(c.env.DB, idParam(c));
  if (!current) return fail(c, 404, "not_found", "Cotización no encontrada");
  const t = now();
  const at = body.at ?? t;
  const bad = badEventDate(at, lastAt(current.history));
  if (bad) return fail(c, 422, "validation_error", bad);
  await db.changeQuoteStatus(c.env.DB, current.id, body.status, body.note ?? "", at, t);
  return c.json({ data: await db.getQuote(c.env.DB, current.id) }, 201);
});

app.patch("/quotes/:id/events/:eventId", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.eventEdit);
  if (body instanceof Response) return body;
  const current = await db.getQuote(c.env.DB, idParam(c));
  const near = current && neighbours(current.history, eventIdParam(c));
  if (!current || !near) return fail(c, 404, "not_found", "Cambio de estado no encontrado");
  const bad = body.at && badEventDate(body.at, near.before, near.after);
  if (bad) return fail(c, 422, "validation_error", bad);
  await db.editQuoteEvent(c.env.DB, current.id, eventIdParam(c), body, near.isLast, now());
  return c.json({ data: await db.getQuote(c.env.DB, current.id) });
});

// --- Actividades (registro de tiempo) ---------------------------------------

app.post("/activities", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.createActivity);
  if (body instanceof Response) return body;
  if (endBeforeStart(body.startedAt ?? now(), body.endedAt)) {
    return fail(c, 422, "validation_error", "La hora de fin es anterior a la de inicio");
  }
  const id = await db.createActivity(c.env.DB, body, now());
  c.header("Location", `/api/v1/activities/${id}`);
  return c.json({ data: await db.getActivity(c.env.DB, id) }, 201);
});

app.patch("/activities/:id", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.updateActivity);
  if (body instanceof Response) return body;
  const current = await db.getActivity(c.env.DB, idParam(c));
  if (!current) return fail(c, 404, "not_found", "Actividad no encontrada");
  const start = body.startedAt ?? current.startedAt;
  const end = body.endedAt !== undefined ? body.endedAt : current.endedAt;
  if (endBeforeStart(start, end)) return fail(c, 422, "validation_error", "La hora de fin es anterior a la de inicio");
  await db.updateActivity(c.env.DB, current.id, body, now());
  return c.json({ data: await db.getActivity(c.env.DB, current.id) });
});

app.delete("/activities/:id", editorOnly, async (c) => {
  if (!(await db.deleteActivity(c.env.DB, idParam(c)))) return fail(c, 404, "not_found", "Actividad no encontrada");
  return c.body(null, 204);
});

app.notFound((c) => fail(c, 404, "not_found", "Ruta no encontrada"));

export default app;
