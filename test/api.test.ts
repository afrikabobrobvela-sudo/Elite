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
        receivedAt: "2026-10-05T15:30:00.000Z",
        businessDays: 7,
        dueOn: "2026-10-14",
      }),
    });
    expect(created.status).toBe(201);
    const { data: sample } = (await created.json()) as { data: { id: string; stage: string; history: unknown[] } };
    expect(sample.stage).toBe("recibo_muestra");
    expect(sample.history).toHaveLength(1);

    const moved = await api(editor, `/samples/${sample.id}/stage-changes`, {
      method: "POST",
      body: JSON.stringify({ stage: "maquinado", note: "VoBo recibido" }),
    });
    expect(moved.status).toBe(201);
    const { data: after } = (await moved.json()) as {
      data: { stage: string; stageSince: string; history: { stage: string; at: string; note: string }[] };
    };
    expect(after.stage).toBe("maquinado");
    expect(after.history.map((h) => h.stage)).toEqual(["recibo_muestra", "maquinado"]);
    expect(after.history[1]!.note).toBe("VoBo recibido");
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
      body: JSON.stringify({ stage: "inventada", dueOn: "14/10/2026", test: "Dureza", receivedAt: "2026-10-05" }),
    });
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { error: { details: { field: string }[] } };
    expect(body.error.details.map((d) => d.field).sort()).toEqual(["dueOn", "receivedAt", "stage", "test"]);
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
      ["/quotes", "POST", { number: "X" }],
      ["/activities", "POST", { type: "otra" }],
      [`/samples/${data.id}`, "PATCH", { code: "X" }],
      [`/samples/${data.id}`, "DELETE", undefined],
      [`/samples/${data.id}/stage-changes`, "POST", { stage: "maquinado" }],
      [`/samples/${data.id}/events/1`, "PATCH", { note: "X" }],
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

describe("acondicionamiento", () => {
  it("anota inicio y fin al entrar y salir de Acondicionando", async () => {
    const editor = await login("clave-editor");
    const created = await api(editor, "/samples", {
      method: "POST",
      body: JSON.stringify({ code: "M26.800", test: "Flamabilidad Horizontal", stage: "recibido" }),
    });
    const { data } = (await created.json()) as { data: { id: string } };
    const move = async (stage: string) =>
      ((await (await api(editor, `/samples/${data.id}/stage-changes`, { method: "POST", body: JSON.stringify({ stage }) })).json()) as {
        data: { conditioningStart: string | null; conditioningEnd: string | null };
      }).data;

    const inCond = await move("acondicionando");
    expect(inCond.conditioningStart).toBeTruthy();
    expect(inCond.conditioningEnd).toBeNull();
    const inTest = await move("prueba");
    expect(inTest.conditioningStart).toBe(inCond.conditioningStart);
    expect(inTest.conditioningEnd).toBeTruthy();
  });

  it("respeta fechas capturadas a mano y rechaza un fin anterior al inicio", async () => {
    const editor = await login("clave-editor");
    const created = await api(editor, "/samples", {
      method: "POST",
      body: JSON.stringify({ code: "M26.801", stage: "recibido" }),
    });
    const { data } = (await created.json()) as { data: { id: string } };
    const patch = (body: object) => api(editor, `/samples/${data.id}`, { method: "PATCH", body: JSON.stringify(body) });

    expect((await patch({ conditioningStart: "2026-10-01T14:00:00.000Z" })).status).toBe(200);
    expect((await patch({ conditioningEnd: "2026-09-30T14:00:00.000Z" })).status).toBe(422);
    const ok = await patch({ conditioningEnd: "2026-10-03T14:00:00.000Z", adminByMe: false });
    const s = ((await ok.json()) as { data: { conditioningEnd: string; adminByMe: boolean } }).data;
    expect(s.conditioningEnd).toBe("2026-10-03T14:00:00.000Z");
    expect(s.adminByMe).toBe(false);

    const moved = await api(editor, `/samples/${data.id}/stage-changes`, { method: "POST", body: JSON.stringify({ stage: "acondicionando" }) });
    expect(((await moved.json()) as { data: { conditioningStart: string } }).data.conditioningStart).toBe("2026-10-01T14:00:00.000Z");
  });
});

describe("cotizaciones", () => {
  it("crea, cambia de estado con historial y vincula muestras", async () => {
    const editor = await login("clave-editor");
    const res = await api(editor, "/quotes", {
      method: "POST",
      body: JSON.stringify({ number: "C26.900", client: "Cliente Demo", tests: "FTIR x2" }),
    });
    expect(res.status).toBe(201);
    const { data: quote } = (await res.json()) as { data: { id: string; status: string } };
    expect(quote.status).toBe("elaboracion");

    const sent = await api(editor, `/quotes/${quote.id}/status-changes`, {
      method: "POST",
      body: JSON.stringify({ status: "enviada", note: "Por correo" }),
    });
    const after = ((await sent.json()) as { data: { status: string; history: { status: string }[] } }).data;
    expect(after.status).toBe("enviada");
    expect(after.history.map((h) => h.status)).toEqual(["elaboracion", "enviada"]);

    const sample = await api(editor, "/samples", {
      method: "POST",
      body: JSON.stringify({ code: "M26.901", quoteId: quote.id, quote: "C26.900", test: "FTIR" }),
    });
    const { data: s } = (await sample.json()) as { data: { id: string; quoteId: string } };
    expect(s.quoteId).toBe(quote.id);

    const board = (await (await api(editor, "/board")).json()) as {
      data: { quotes: { id: string }[]; samples: { id: string; quoteId: string | null }[] };
    };
    expect(board.data.quotes.some((q) => q.id === quote.id)).toBe(true);

    // Al borrar la cotización la muestra se conserva sin vínculo.
    expect((await api(editor, `/quotes/${quote.id}`, { method: "DELETE" })).status).toBe(204);
    const kept = (await (await api(editor, `/samples/${s.id}`)).json()) as { data: { quoteId: string | null } };
    expect(kept.data.quoteId).toBeNull();
  });

  it("registra fechas pasadas, llegada de la orden de compra y correcciones al historial", async () => {
    const editor = await login("clave-editor");
    const post = (path: string, body: unknown) => api(editor, path, { method: "POST", body: JSON.stringify(body) });
    type Q = { id: string; status: string; statusSince: string; poReceivedAt: string | null; history: { id: number; status: string; at: string }[] };
    const read = async (res: Response) => ((await res.json()) as { data: Q }).data;

    const q = await read(await post("/quotes", { number: "C26.950", at: "2026-09-01T16:00:00.000Z" }));
    expect(q.history[0]!.at).toBe("2026-09-01T16:00:00.000Z");
    await post(`/quotes/${q.id}/status-changes`, { status: "enviada", at: "2026-09-02T16:00:00.000Z" });
    const bought = await read(await post(`/quotes/${q.id}/status-changes`, { status: "comprada", at: "2026-09-20T16:00:00.000Z" }));
    expect(bought.statusSince).toBe("2026-09-20T16:00:00.000Z");
    expect(bought.poReceivedAt).toBe("2026-09-20T16:00:00.000Z");

    // Fuera de orden o en el futuro: rechazado.
    expect((await post(`/quotes/${q.id}/status-changes`, { status: "perdida", at: "2026-09-10T16:00:00.000Z" })).status).toBe(422);
    expect((await post(`/quotes/${q.id}/status-changes`, { status: "perdida", at: "2099-01-01T00:00:00.000Z" })).status).toBe(422);

    // Corregir la fecha del último cambio mueve "desde cuándo".
    const last = bought.history[2]!;
    const fixed = await read(await api(editor, `/quotes/${q.id}/events/${last.id}`, { method: "PATCH", body: JSON.stringify({ at: "2026-09-19T16:00:00.000Z" }) }));
    expect(fixed.statusSince).toBe("2026-09-19T16:00:00.000Z");
    // No puede quedar antes del cambio anterior.
    const tooEarly = await api(editor, `/quotes/${q.id}/events/${last.id}`, { method: "PATCH", body: JSON.stringify({ at: "2026-08-01T16:00:00.000Z" }) });
    expect(tooEarly.status).toBe(422);

    // La llegada de la orden de compra se puede capturar aparte.
    const po = await api(editor, `/quotes/${q.id}`, { method: "PATCH", body: JSON.stringify({ poReceivedAt: "2026-09-18T18:00:00.000Z" }) });
    expect((await read(po)).poReceivedAt).toBe("2026-09-18T18:00:00.000Z");

    // Muestras: alta con fecha pasada y corrección de un cambio de etapa.
    const res = await post("/samples", { code: "M26.950", at: "2026-09-21T15:00:00.000Z" });
    const s = ((await res.json()) as { data: { id: string; stage: string; stageSince: string; history: { id: number }[] } }).data;
    expect(s.stage).toBe("recibo_muestra");
    expect(s.stageSince).toBe("2026-09-21T15:00:00.000Z");
    const edited = await api(editor, `/samples/${s.id}/events/${s.history[0]!.id}`, { method: "PATCH", body: JSON.stringify({ at: "2026-09-21T14:00:00.000Z", note: "Llegó en la mañana" }) });
    const after = ((await edited.json()) as { data: { stageSince: string; history: { note: string }[] } }).data;
    expect(after.stageSince).toBe("2026-09-21T14:00:00.000Z");
    expect(after.history[0]!.note).toBe("Llegó en la mañana");
  });

  it("el jefe no puede crear cotizaciones", async () => {
    const viewer = await login("clave-del-jefe");
    expect((await api(viewer, "/quotes", { method: "POST", body: JSON.stringify({ number: "X" }) })).status).toBe(403);
  });
});

describe("registro de tiempo", () => {
  it("al iniciar una actividad se detiene la que estaba en curso", async () => {
    const editor = await login("clave-editor");
    const start = (type: string) =>
      api(editor, "/activities", { method: "POST", body: JSON.stringify({ type, note: type }) }).then(
        async (r) => ((await r.json()) as { data: { id: string; endedAt: string | null } }).data,
      );
    const first = await start("cotizacion");
    expect(first.endedAt).toBeNull();
    const second = await start("prueba");
    const board = (await (await api(editor, "/board")).json()) as {
      data: { activities: { id: string; endedAt: string | null }[] };
    };
    const byId = Object.fromEntries(board.data.activities.map((a) => [a.id, a]));
    expect(byId[first.id]!.endedAt).toBeTruthy();
    expect(byId[second.id]!.endedAt).toBeNull();

    const stopped = await api(editor, `/activities/${second.id}`, {
      method: "PATCH",
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    });
    expect(((await stopped.json()) as { data: { endedAt: string | null } }).data.endedAt).toBeTruthy();
  });

  it("acepta bloques capturados a mano y valida el orden de las horas", async () => {
    const editor = await login("clave-editor");
    const ok = await api(editor, "/activities", {
      method: "POST",
      body: JSON.stringify({ type: "norma", startedAt: "2026-10-01T15:00:00.000Z", endedAt: "2026-10-01T16:30:00.000Z" }),
    });
    expect(ok.status).toBe(201);
    const bad = await api(editor, "/activities", {
      method: "POST",
      body: JSON.stringify({ type: "norma", startedAt: "2026-10-01T15:00:00.000Z", endedAt: "2026-10-01T14:00:00.000Z" }),
    });
    expect(bad.status).toBe(422);
    const badType = await api(editor, "/activities", { method: "POST", body: JSON.stringify({ type: "dormir" }) });
    expect(badType.status).toBe(422);
  });
});

describe("catálogo", () => {
  it("VoBo va antes de Recibido y la lista de pruebas está completa", async () => {
    const viewer = await login("clave-del-jefe");
    const { data } = (await (await api(viewer, "/catalog")).json()) as {
      data: { stages: { key: string }[]; tests: string[] };
    };
    expect(data.stages.map((s) => s.key)).toEqual([
      "recibo_muestra", "vobo", "maquinado", "probetas", "recibido", "acondicionando", "prueba", "reporte", "revision", "entregado",
    ]);
    expect(data.tests).toHaveLength(17);
    expect(data.tests).toContain("Prueba de Impacto");
  });

  it("se puede leer sin sesión (lo usa el modo demo), pero los datos no", async () => {
    expect((await worker.fetch(`${BASE}/catalog`)).status).toBe(200);
    expect((await worker.fetch(`${BASE}/board`)).status).toBe(401);
  });
});
