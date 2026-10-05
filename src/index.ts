import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { z } from "zod";
import { COOKIE_NAME, SESSION_TTL_SECONDS, roleForPassword, signSession, verifySession, type Role } from "./auth";
import * as db from "./db";
import * as schemas from "./schemas";
import { STAGES } from "./stages";

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

app.get("/stages", (c) => c.json({ data: STAGES }));

// --- Muestras ---------------------------------------------------------------

app.get("/samples", async (c) => {
  // La página pregunta cada pocos segundos; si nada cambió responde 304 sin leer las muestras.
  const etag = `W/"${await db.boardVersion(c.env.DB)}"`;
  if (c.req.header("If-None-Match") === etag) {
    c.header("ETag", etag);
    return c.body(null, 304);
  }
  const samples = await db.listSamples(c.env.DB);
  c.header("ETag", etag);
  return c.json({ data: samples, meta: { serverTime: new Date().toISOString() } });
});

app.get("/samples/:id", async (c) => {
  const sample = await db.getSample(c.env.DB, c.req.param("id"));
  return sample ? c.json({ data: sample }) : fail(c, 404, "not_found", "Muestra no encontrada");
});

app.post("/samples", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.createSample);
  if (body instanceof Response) return body;
  const { stage, note, ...fields } = body;
  const id = await db.createSample(c.env.DB, fields, stage, note ?? "", new Date().toISOString());
  c.header("Location", `/api/v1/samples/${id}`);
  return c.json({ data: await db.getSample(c.env.DB, id) }, 201);
});

app.patch("/samples/:id", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.updateSample);
  if (body instanceof Response) return body;
  const id = c.req.param("id") ?? "";
  if (!(await db.updateSample(c.env.DB, id, body, new Date().toISOString()))) {
    return fail(c, 404, "not_found", "Muestra no encontrada");
  }
  return c.json({ data: await db.getSample(c.env.DB, id) });
});

app.delete("/samples/:id", editorOnly, async (c) => {
  if (!(await db.deleteSample(c.env.DB, c.req.param("id") ?? ""))) {
    return fail(c, 404, "not_found", "Muestra no encontrada");
  }
  return c.body(null, 204);
});

app.post("/samples/:id/stage-changes", editorOnly, async (c) => {
  const body = await parseBody(c, schemas.stageChange);
  if (body instanceof Response) return body;
  const id = c.req.param("id") ?? "";
  if (!(await db.changeStage(c.env.DB, id, body.stage, body.note ?? "", new Date().toISOString()))) {
    return fail(c, 404, "not_found", "Muestra no encontrada");
  }
  return c.json({ data: await db.getSample(c.env.DB, id) }, 201);
});

app.notFound((c) => fail(c, 404, "not_found", "Ruta no encontrada"));

export default app;
