// Modo demo: datos ficticios generados en el navegador. No toca la base de datos real;
// los cambios viven en memoria y se pierden al salir o recargar.
import { addBusinessDays, isBusinessDay, isoDay } from "/business-days.js";

const CLIENTS = [
  "Polímeros Ficticios", "Autopartes Demo", "Empaques Ejemplo", "Moldeados de Prueba",
  "Textiles Imaginarios", "Hules Modelo", "Interiores Simulados", "Compuestos Ficticios",
];
const SELLERS = ["Ana (demo)", "Luis (demo)", "Sofía (demo)"];
const OTHER_CONSULTANTS = ["Consultor B", "Consultor C"];
const STANDARDS = { "Flamabilidad Horizontal": "FMVSS 302", FTIR: "ASTM E1252", "Color y Brillo": "ASTM D523", VICAT: "ISO 306", PV1200: "PV 1200", Fogging: "DIN 75201", Olor: "VDA 270", Densidad: "ASTM D792" };

/** Generador pseudoaleatorio con semilla: los mismos datos en cada visita. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let db = null;
let version = 0;
let role = "editor";
let seq = 0;
const newId = () => `demo-${++seq}`;

/** Avanza n días hábiles y fija una hora del día (9 a 17 h). */
function stepBusiness(d, n, r) {
  const out = new Date(addBusinessDays(isoDay(d), n) + "T00:00");
  out.setHours(9 + Math.floor(r() * 8), Math.floor(r() * 4) * 15);
  return out;
}

function generate(catalog, now) {
  const r = rng(20261005);
  const tests = catalog.tests;
  const pick = (list) => list[Math.floor(r() * list.length)];
  const nowMs = now.getTime();
  const quotes = [];
  const samples = [];
  const start = new Date(now);
  start.setDate(start.getDate() - 45);

  // Cotizaciones: una o dos por día hábil, cada una con su recorrido hasta hoy.
  let n = 640;
  for (const d = new Date(start); d < now; d.setDate(d.getDate() + 1)) {
    if (!isBusinessDay(d)) continue;
    const perDay = r() < 0.35 ? 2 : r() < 0.8 ? 1 : 0;
    for (let k = 0; k < perDay; k++) {
      const created = new Date(d);
      created.setHours(9 + Math.floor(r() * 7), Math.floor(r() * 4) * 15);
      if (created.getTime() > nowMs) continue;
      const qTests = [pick(tests), ...(r() < 0.3 ? [pick(tests)] : [])].filter((t, i, a) => a.indexOf(t) === i);
      const q = {
        id: newId(), number: `D26.${n++}`, client: pick(CLIENTS), salesRep: pick(SELLERS),
        tests: qTests.join(", "), notes: "", history: [],
      };
      const path = [["elaboracion", created]];
      let t = stepBusiness(created, r() < 0.6 ? 0 : 1, r);
      if (t <= created) t = new Date(created.getTime() + 2 * 36e5);
      path.push(["enviada", t]);
      if (r() < 0.6) path.push(["seguimiento", (t = stepBusiness(t, 2 + Math.floor(r() * 3), r))]);
      const fate = r();
      if (fate < 0.65) path.push(["comprada", (t = stepBusiness(t, 1 + Math.floor(r() * 3), r))]);
      else if (fate < 0.8) path.push(["perdida", (t = stepBusiness(t, 3 + Math.floor(r() * 4), r))]);
      const done = path.filter(([, at]) => at.getTime() <= nowMs);
      q.history = done.map(([status, at]) => ({ status, at: at.toISOString(), note: "" }));
      const last = q.history[q.history.length - 1];
      Object.assign(q, { status: last.status, statusSince: last.at, createdAt: q.history[0].at, updatedAt: last.at });
      quotes.push(q);
      if (q.status === "comprada") for (const test of qTests) samples.push(makeSample(r, test, q, new Date(last.at), nowMs, true));
    }
  }
  // Muestras que llegan de otros vendedores: lo administrativo no es de Rodrigo.
  for (let k = 0; k < 8; k++) {
    const since = new Date(start.getTime() + r() * (nowMs - start.getTime()));
    samples.push(makeSample(r, pick(tests), null, since, nowMs, false));
  }
  samples.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  samples.forEach((s, i) => (s.code = `MD.${String(100 + i)}`));
  return { quotes, samples, activities: makeActivities(r, quotes, samples, start, now) };
}

function makeSample(r, test, q, start, nowMs, adminByMe) {
  const testByMe = r() < 0.8;
  const flame = test === "Flamabilidad Horizontal";
  const steps = adminByMe
    ? [["vobo", 0], ["maquinado", 1 + Math.floor(r() * 2)], ["probetas", 2 + Math.floor(r() * 3)], ["recibido", Math.floor(r() * 2)]]
    : [["recibido", 0]];
  // Flamabilidad: de 1 a 7 días; de vez en cuando se pasa para que se vea el aviso.
  const condDays = flame ? (r() < 0.15 ? 8 : 1 + Math.floor(r() * 6)) : 1 + Math.floor(r() * 2);
  steps.push(["acondicionando", Math.floor(r() * 2)], ["prueba", condDays], ["reporte", 1 + Math.floor(r() * 2)], ["revision", 1 + Math.floor(r() * 2)], ["entregado", 1 + Math.floor(r() * 2)]);
  const events = [];
  let t = new Date(start);
  for (const [stage, gap] of steps) {
    t = gap ? stepBusiness(t, gap, r) : new Date(t.getTime() + (1 + r() * 3) * 36e5);
    events.push({ stage, at: t.toISOString(), note: "" });
  }
  const history = events.filter((e) => Date.parse(e.at) <= nowMs);
  if (!history.length) history.push({ ...events[0], at: new Date(Math.min(nowMs - 36e5, Date.parse(events[0].at))).toISOString() });
  const last = history[history.length - 1];
  const at = (stage) => history.find((e) => e.stage === stage)?.at ?? null;
  const receivedAt = at("recibido");
  const businessDays = flame ? 10 : pick3(r, [5, 7, 7]);
  return {
    id: newId(), code: "", quote: q?.number ?? "", quoteId: q?.id ?? null, client: q?.client ?? CLIENTS[Math.floor(r() * CLIENTS.length)],
    test, standard: STANDARDS[test] ?? "", consultant: testByMe ? "Rodrigo" : OTHER_CONSULTANTS[Math.floor(r() * 2)],
    salesRep: q?.salesRep ?? SELLERS[Math.floor(r() * SELLERS.length)], adminByMe, testByMe,
    receivedAt, businessDays: receivedAt ? businessDays : null,
    dueOn: receivedAt ? addBusinessDays(isoDay(new Date(receivedAt)), businessDays + (r() < 0.2 ? -3 : 0)) : null,
    conditioningStart: at("acondicionando"), conditioningEnd: at("prueba"),
    stage: last.stage, stageSince: last.at, deliveredAt: at("entregado"),
    createdAt: history[0].at, updatedAt: last.at, history,
  };
}

const pick3 = (r, list) => list[Math.floor(r() * list.length)];

/** Bloques de trabajo de 8:30 a 17:30 por día hábil; unos días pesan más en lo administrativo. */
function makeActivities(r, quotes, samples, start, now) {
  const out = [];
  const ADMIN = ["cotizacion", "cotizacion", "norma", "seguimiento", "clientes", "recibo", "maquinado"];
  const EVAL = ["prueba", "prueba", "reporte", "reporte", "revision"];
  for (const d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    if (!isBusinessDay(d)) continue;
    const adminShare = 0.15 + r() * 0.6;
    let t = new Date(d);
    t.setHours(8, 30, 0, 0);
    const end = new Date(d);
    end.setHours(17, 30, 0, 0);
    while (t < end) {
      if (t.getHours() === 13 && t.getMinutes() >= 30) {
        t = new Date(t.getTime() + 60 * 6e4); // comida
        continue;
      }
      const mins = 30 * (1 + Math.floor(r() * 5));
      const stop = new Date(Math.min(t.getTime() + mins * 6e4, end.getTime()));
      const kind = r() < 0.06 ? "otra" : r() < adminShare ? ADMIN[Math.floor(r() * ADMIN.length)] : EVAL[Math.floor(r() * EVAL.length)];
      const ref = linkFor(r, kind, quotes, samples, t);
      if (t.getTime() >= now.getTime()) break;
      const running = stop.getTime() > now.getTime();
      out.push({ id: newId(), type: kind, startedAt: t.toISOString(), endedAt: running ? null : stop.toISOString(), note: "", ...ref });
      if (running) break;
      t = stop;
    }
  }
  return out;
}

function linkFor(r, kind, quotes, samples, t) {
  const ms = t.getTime();
  if (["cotizacion", "norma", "seguimiento"].includes(kind)) {
    const open = quotes.filter((q) => Date.parse(q.createdAt) <= ms && Date.parse(q.createdAt) > ms - 6 * 864e5);
    if (open.length && r() < 0.8) return { quoteId: open[Math.floor(r() * open.length)].id, sampleId: null };
  }
  if (["prueba", "reporte", "recibo", "maquinado"].includes(kind)) {
    const mine = samples.filter((s) => s.testByMe && Date.parse(s.createdAt) <= ms && (!s.deliveredAt || Date.parse(s.deliveredAt) >= ms));
    if (mine.length && r() < 0.8) return { quoteId: null, sampleId: mine[Math.floor(r() * mine.length)].id };
  }
  return { quoteId: null, sampleId: null };
}

// --- API simulada ----------------------------------------------------------------

export function startDemo(catalog, asRole = "editor") {
  seq = 0;
  role = asRole;
  db = generate(catalog, new Date());
  version++;
}
export const stopDemo = () => (db = null);
export const demoActive = () => db !== null;
export const setDemoRole = (r) => (role = r);

const ok = (data, status = 200) => ({ status, headers: new Headers({ ETag: `"demo-${version}"` }), data });
const noContent = () => ({ status: 204, headers: new Headers() });
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const clone = (x) => structuredClone(x);
const changed = () => version++;

function changeStage(s, stage, note, now) {
  if (stage === "acondicionando" && !s.conditioningStart) s.conditioningStart = now;
  if (s.stage === "acondicionando" && stage !== "acondicionando" && !s.conditioningEnd) s.conditioningEnd = now;
  Object.assign(s, { stage, stageSince: now, deliveredAt: stage === "entregado" ? now : null, updatedAt: now });
  s.history.push({ stage, at: now, note: note || "" });
}

function setRunning(a) {
  if (a.endedAt) return;
  const now = new Date().toISOString();
  for (const x of db.activities) if (!x.endedAt && x.id !== a.id) x.endedAt = now;
}

/** Mismas rutas y respuestas que el servidor, sobre los datos en memoria. */
export async function demoApi(path, { method = "GET", body, headers = {} } = {}) {
  const now = new Date().toISOString();
  const [, kind, id, sub] = path.split("/");
  const write = method !== "GET";
  if (kind === "session") return method === "DELETE" ? noContent() : ok({ role });
  if (write && role !== "editor") fail(403, "Solo lectura");
  if (kind === "board") {
    if (headers["If-None-Match"] === `"demo-${version}"`) return { status: 304, headers: new Headers() };
    return ok(clone(db));
  }
  if (kind === "samples") {
    if (method === "POST" && !id) {
      const { stage = "vobo", note = "", ...fields } = body;
      const s = { id: newId(), quoteId: null, adminByMe: true, testByMe: true, conditioningStart: null, conditioningEnd: null, ...fields, createdAt: now, history: [] };
      changeStage(s, stage, note, now);
      db.samples.push(s);
      changed();
      return ok(clone(s), 201);
    }
    const s = db.samples.find((x) => x.id === id) ?? fail(404, "Muestra no encontrada");
    if (sub === "stage-changes") changeStage(s, body.stage, body.note, now);
    else if (method === "PATCH") Object.assign(s, body, { updatedAt: now });
    else if (method === "DELETE") {
      db.samples = db.samples.filter((x) => x !== s);
      for (const a of db.activities) if (a.sampleId === id) a.sampleId = null;
      changed();
      return noContent();
    }
    if (write) changed();
    return ok(clone(s), write ? 201 : 200);
  }
  if (kind === "quotes") {
    if (method === "POST" && !id) {
      const { status = "elaboracion", note = "", ...fields } = body;
      const q = { id: newId(), number: "", client: "", salesRep: "", tests: "", notes: "", ...fields, status, statusSince: now, createdAt: now, updatedAt: now, history: [{ status, at: now, note }] };
      db.quotes.push(q);
      changed();
      return ok(clone(q), 201);
    }
    const q = db.quotes.find((x) => x.id === id) ?? fail(404, "Cotización no encontrada");
    if (sub === "status-changes") {
      Object.assign(q, { status: body.status, statusSince: now, updatedAt: now });
      q.history.push({ status: body.status, at: now, note: body.note || "" });
    } else if (method === "PATCH") Object.assign(q, body, { updatedAt: now });
    else if (method === "DELETE") {
      db.quotes = db.quotes.filter((x) => x !== q);
      for (const x of [...db.samples, ...db.activities]) if (x.quoteId === id) x.quoteId = null;
      changed();
      return noContent();
    }
    if (write) changed();
    return ok(clone(q), write ? 201 : 200);
  }
  if (kind === "activities") {
    if (body?.endedAt && body.startedAt && body.endedAt < body.startedAt) fail(422, "La hora de fin es anterior a la de inicio");
    if (method === "POST") {
      const a = { id: newId(), startedAt: now, endedAt: null, note: "", quoteId: null, sampleId: null, ...body };
      setRunning(a);
      db.activities.push(a);
      changed();
      return ok(clone(a), 201);
    }
    const a = db.activities.find((x) => x.id === id) ?? fail(404, "Registro no encontrado");
    if (method === "DELETE") {
      db.activities = db.activities.filter((x) => x !== a);
      changed();
      return noContent();
    }
    Object.assign(a, body);
    setRunning(a);
    changed();
    return ok(clone(a), 201);
  }
  fail(404, "Ruta no encontrada");
}
