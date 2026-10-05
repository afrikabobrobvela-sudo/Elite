/**
 * Sesiones con cookie firmada (HMAC-SHA256). Dos roles:
 * - editor: Rodrigo, puede crear muestras y cambiar etapas.
 * - viewer: el jefe, solo ve el tablero.
 */
export type Role = "editor" | "viewer";

export const COOKIE_NAME = "elite_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(role: Role, secret: string, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ r: role, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<Role | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { r?: unknown; exp?: unknown };
    if (typeof data.exp !== "number" || data.exp * 1000 < now) return null;
    return data.r === "editor" || data.r === "viewer" ? data.r : null;
  } catch {
    return null;
  }
}

/** Compara dos cadenas sin filtrar por tiempo cuántos caracteres coinciden. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Rol que corresponde a la contraseña, o null. La de edición tiene prioridad. */
export async function roleForPassword(
  password: string,
  env: { EDITOR_PASSWORD: string; VIEWER_PASSWORD: string },
): Promise<Role | null> {
  const [isEditor, isViewer] = await Promise.all([
    safeEqual(password, env.EDITOR_PASSWORD),
    safeEqual(password, env.VIEWER_PASSWORD),
  ]);
  if (isEditor) return "editor";
  if (isViewer) return "viewer";
  return null;
}
