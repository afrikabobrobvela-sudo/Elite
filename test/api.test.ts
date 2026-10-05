import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://elite.test/api/v1";
const worker = (exports as unknown as { default: Fetcher }).default;

async function login(password: string): Promise<string> {
  const res = await worker.fetch(`${BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  return cookie.split(";")[0]!;
}

function api(cookie: string, path: string, init: RequestInit = {}) {
  return worker.fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers ?? {}) },
  });
}

describe("sesión", () => {
  it("rechaza sin sesión", async () => {
    const res = await worker.fetch(`${BASE}/samples`);
    expect(res.status).toBe(401);
  });

  it("rechaza contraseña incorrecta y bloquea tras 10 intentos", async () => {
    const attempt = () =>
      worker.fetch(`${BASE}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({ password: "mala" }),
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it("asigna el rol según la contraseña", async () => {
    const editor = await login("clave-editor");
    const viewer = await login("clave-del-jefe");
    expect(await (await api(editor, "/session")).json()).toEqual({ data: { role: "editor" } });
    expect(await (await api(viewer, "/session")).json()).toEqual({ data: { role: "viewer" } });
  });

  it("rechaza una cookie alterada", async () => {
    const viewer = await login("clave-del-jefe");
    const [payload, sig] = viewer.split("=")[1]!.split(".");
    const forged = btoa(JSON.stringify({ r: "editor", exp: 9999999999 })).replace(/=+$/, "");
    expect((await api(`elite_session=${forged}.${sig}`, "/session")).status).toBe(401);
    expect(payload).toBeTruthy();
  });
});

describe("muestras", () => {
  it("crea, cambia de etapa con hora del servidor y guarda historial", async () => {
    const editor = await login("clave-editor");
    const created = await api(editor, "/samples", {
      method: "POST",
      body: JSON.stringify({
        code: "M26.700",
        test: "FTIR",
        client: "Cliente Demo",
        receivedOn: "2026-10-05",
        businessDays: 7,
        dueOn: "2026-10-14",
      }),
    });
    expect(created.status).toBe(201);
    const { data: sample } = (await created.json()) as { data: { id: string; stage: string; history: unknown[] } };
    expect(sample.stage).toBe("recibido");
    expect(sample.history).toHaveLength(1);

    const moved = await api(editor, `/samples/${sample.id}/stage-changes`, {
      method: "POST",
      body: JSON.stringify({ stage: "vobo", note: "Enviado al cliente" }),
    });
    expect(moved.status).toBe(201);
    const { data: after } = (await moved.json()) as {
      data: { stage: string; stageSince: string; history: { stage: string; at: string; note: string }[] };
    };
    expect(after.stage).toBe("vobo");
    expect(after.history.map((h) => h.stage)).toEqual(["recibido", "vobo"]);
    expect(after.history[1]!.note).toBe("Enviado al cliente");
    expect(Date.now() - Date.parse(after.stageSince)).toBeLessThan(60_000);

    const done = await api(editor, `/samples/${sample.id}/stage-changes`, {
      method: "POST",
      body: JSON.stringify({ stage: "entregado" }),
    });
    expect(((await done.json()) as { data: { deliveredAt: string | null } }).data.deliveredAt).toBeTruthy();
  });

  it("valida etapas y fechas", async () => {
    const editor = await login("clave-editor");
    const bad = await api(editor, "/samples", {
      method: "POST",
      body: JSON.stringify({ stage: "inventada", dueOn: "14/10/2026" }),
    });
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { error: { details: { field: string }[] } };
    expect(body.error.details.map((d) => d.field).sort()).toEqual(["dueOn", "stage"]);
  });

  it("el jefe ve pero no puede modificar", async () => {
    const editor = await login("clave-editor");
    const viewer = await login("clave-del-jefe");
    const created = await api(editor, "/samples", { method: "POST", body: JSON.stringify({ code: "M26.701" }) });
    const { data } = (await created.json()) as { data: { id: string } };

    const list = await api(viewer, "/samples");
    expect(list.status).toBe(200);
    const { data: samples } = (await list.json()) as { data: { code: string }[] };
    expect(samples.some((s) => s.code === "M26.701")).toBe(true);

    for (const [path, method, body] of [
      ["/samples", "POST", { code: "X" }],
      [`/samples/${data.id}`, "PATCH", { code: "X" }],
      [`/samples/${data.id}`, "DELETE", undefined],
      [`/samples/${data.id}/stage-changes`, "POST", { stage: "vobo" }],
    ] as const) {
      const res = await api(viewer, path, { method, body: body && JSON.stringify(body) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("responde 304 si el tablero no cambió y 200 cuando cambia", async () => {
    const editor = await login("clave-editor");
    const first = await api(editor, "/samples");
    const etag = first.headers.get("ETag")!;
    expect(etag).toBeTruthy();
    expect((await api(editor, "/samples", { headers: { "If-None-Match": etag } })).status).toBe(304);
    await api(editor, "/samples", { method: "POST", body: JSON.stringify({ code: "M26.702" }) });
    const changed = await api(editor, "/samples", { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
  });

  it("edita datos y elimina con historial", async () => {
    const editor = await login("clave-editor");
    const created = await api(editor, "/samples", { method: "POST", body: JSON.stringify({ code: "M26.703" }) });
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await api(editor, `/samples/${data.id}`, {
      method: "PATCH",
      body: JSON.stringify({ client: "Otro cliente", dueOn: null }),
    });
    expect(((await patched.json()) as { data: { client: string } }).data.client).toBe("Otro cliente");

    expect((await api(editor, `/samples/${data.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(editor, `/samples/${data.id}`)).status).toBe(404);
    expect((await api(editor, `/samples/${data.id}/stage-changes`, {
      method: "POST",
      body: JSON.stringify({ stage: "vobo" }),
    })).status).toBe(404);
  });

  it("bloquea escrituras desde otro origen", async () => {
    const editor = await login("clave-editor");
    const res = await api(editor, "/samples", {
      method: "POST",
      headers: { Origin: "https://otro-sitio.example" },
      body: JSON.stringify({ code: "X" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("clave para limitar intentos", async () => {
  const { clientKey } = await import("../src/index");
  it("agrupa IPv6 por /64 y deja IPv4 completa", () => {
    expect(clientKey("203.0.113.9")).toBe("203.0.113.9");
    expect(clientKey("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(clientKey("2001:db8:abcd:0012::99")).toBe("2001:db8:abcd:12::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey(undefined)).toBe("desconocida");
  });
});
