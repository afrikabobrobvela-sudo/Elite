// Estado compartido, llamadas a la API, formato y panel lateral.
import { businessDaysBetween } from "/business-days.js";

export const state = {
  role: null,
  catalog: null,
  samples: [],
  quotes: [],
  activities: [],
  etag: null,
  query: "",
  view: "muestras",
  demo: false,
};

export const $ = (id) => document.getElementById(id);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const canWrite = () => state.role === "editor";

// --- API --------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

// En modo demo las llamadas las contesta js/demo.js en el navegador (el catálogo sí viene del servidor).
let localApi = null;
export const setLocalApi = (fn) => (localApi = fn);

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  if (localApi && path !== "/catalog") return localApi(path, { method, body, headers });
  const res = await fetch("/api/v1" + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/session") {
    onUnauthorized();
    throw new ApiError(401, "unauthenticated", "Inicia sesión");
  }
  if (res.status === 204 || res.status === 304) return { status: res.status, headers: res.headers };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error?.code, json.error?.message || "Error");
  return { status: res.status, headers: res.headers, ...json };
}

let refresher = async () => {};
export const setRefresher = (fn) => (refresher = fn);
export const refresh = () => refresher();

/** Ejecuta una escritura, muestra el error si falla y refresca todo. Devuelve la respuesta o null. */
export async function mutate(fn) {
  try {
    const res = await fn();
    $("banner").hidden = true;
    await refresh();
    return res || true;
  } catch (e) {
    showError(e);
    return null;
  }
}

export function showError(e) {
  if (e.status === 401) return;
  const b = $("banner");
  b.hidden = false;
  b.textContent =
    e.status === 403 ? "Tu acceso es de solo lectura; no puedes cambiar datos." :
    e.status === 422 ? "Revisa los datos: " + e.message :
    "No se pudo guardar el cambio. Revisa tu conexión e inténtalo de nuevo.";
}

// --- Formato ----------------------------------------------------------------

const isDateOnly = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function fmtTs(t, fallback = "fecha no registrada") {
  if (!t) return fallback;
  if (isDateOnly(t)) {
    const [y, m, d] = t.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  }
  return new Date(t).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const fmtTime = (t) => new Date(t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

export function fmtDayLabel(d) {
  return d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

export function ago(t) {
  if (!t) return "tiempo no registrado";
  const ms = Date.now() - new Date(t).getTime();
  const h = ms / 36e5;
  if (h < 1) return Math.max(1, Math.round(ms / 6e4)) + " min";
  if (h < 24) return Math.round(h) + " h";
  const wd = businessDaysBetween(new Date(t), new Date());
  return wd + (wd === 1 ? " día hábil" : " días hábiles");
}

/** Duración entre dos instantes: horas si fue menos de un día, si no días hábiles. */
export function fmtDur(a, b) {
  if (!a || !b) return "";
  const h = (new Date(b) - new Date(a)) / 36e5;
  if (h < 24) return Math.max(0, Math.round(h)) + " h";
  return businessDaysBetween(new Date(a), new Date(b)) + " d háb.";
}

/** Milisegundos → "1 h 20 min". */
export function fmtHours(ms) {
  const min = Math.max(0, Math.round(ms / 6e4));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** ISO (o AAAA-MM-DD) → valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(iso) {
  if (!iso) return "";
  const d = isDateOnly(iso) ? new Date(iso + "T00:00") : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> → ISO (o null si está vacío). */
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

/** Duración de una actividad en ms (la que sigue en curso cuenta hasta ahora). */
export const activityMs = (a, now = Date.now()) =>
  Math.max(0, (a.endedAt ? Date.parse(a.endedAt) : now) - Date.parse(a.startedAt));

// --- Catálogo ---------------------------------------------------------------

export const stages = () => state.catalog.stages;
export const stageOf = (key) => state.catalog.stages.find((s) => s.key === key);
export const stageIdx = (key) => state.catalog.stages.findIndex((s) => s.key === key);
export const quoteStatusOf = (key) => state.catalog.quoteStatuses.find((s) => s.key === key);
export const activityTypeOf = (key) => state.catalog.activityTypes.find((a) => a.key === key);
export const groupOf = (key) => state.catalog.activityGroups.find((g) => g.key === key);
export const quoteById = (id) => state.quotes.find((q) => q.id === id);
export const sampleById = (id) => state.samples.find((s) => s.id === id);

const WAIT_LABEL = { cliente: "Espera al cliente", taller: "Espera al taller", espera: "Acondicionando", par: "Espera revisión de par", admin: "Otra persona", tester: "Otro consultor" };

/** ¿Avanzar esta muestra depende de Rodrigo ahora mismo? */
export function isMine(s) {
  const owner = stageOf(s.stage)?.owner;
  return (owner === "admin" && s.adminByMe) || (owner === "tester" && s.testByMe);
}

/** Etiqueta de a quién le toca: "Te toca" o de quién se espera. */
export function turnLabel(s) {
  if (s.stage === "entregado") return null;
  if (isMine(s)) return { mine: true, t: "Te toca" };
  const owner = stageOf(s.stage)?.owner;
  const t = owner === "tester" && s.consultant ? `Con ${s.consultant}` : WAIT_LABEL[owner] || "En espera";
  return { mine: false, t };
}

/** Estado del acondicionamiento contra el límite de la prueba (flamabilidad: 1 a 7 días naturales). */
export function conditioningInfo(s, now = Date.now()) {
  const limit = state.catalog.conditioningLimits[s.test];
  if (!s.conditioningStart) return null;
  const end = s.conditioningEnd ? Date.parse(s.conditioningEnd) : now;
  const days = (end - Date.parse(s.conditioningStart)) / 864e5;
  const label = `${days < 1 ? fmtHours(days * 864e5) : days.toFixed(1) + " d"}`;
  if (!limit) return { days, c: "", t: `Acondicionamiento ${label}` };
  const range = `${limit.minDays} a ${limit.maxDays} d`;
  if (days > limit.maxDays) return { days, c: "late", t: `Acond. ${label}: excede ${limit.maxDays} d` };
  if (s.conditioningEnd && days < limit.minDays) return { days, c: "warn", t: `Acond. ${label}: menos de ${limit.minDays} d` };
  if (!s.conditioningEnd && days > limit.maxDays - 1) return { days, c: "warn", t: `Acond. ${label} de máx. ${limit.maxDays} d` };
  return { days, c: "ok", t: `Acond. ${label} (${range})` };
}

// --- Panel lateral ------------------------------------------------------------

const drawers = {};
let open = null; // { kind, id, opts }
export const registerSheet = (kind, fn) => (drawers[kind] = fn);
export const sheetOpen = () => open;

export function openSheet(kind, id = "", opts = {}) {
  open = { kind, id, opts, confirmDel: false };
  drawSheet(true);
}

export function closeSheet() {
  open = null;
  $("sheetHost").innerHTML = "";
}

/** Redibuja el panel abierto. No lo hace mientras se escribe en él, para no perder lo capturado. */
export function drawSheet(force = false) {
  if (!open) return;
  const host = $("sheetHost");
  const focused = document.activeElement;
  if (!force && focused && host.contains(focused) && /INPUT|SELECT|TEXTAREA/.test(focused.tagName)) return;
  const html = drawers[open.kind](open);
  if (html === null) return closeSheet();
  host.innerHTML = `<div class="scrim" id="scrim"><aside class="sheet" role="dialog" aria-modal="true" aria-label="${esc(html.label)}">
    <div class="row between"><h3>${esc(html.title)}</h3><button id="closeBtn">Cerrar</button></div>
    ${html.body}</aside></div>`;
  $("scrim").addEventListener("click", (e) => e.target.id === "scrim" && closeSheet());
  $("closeBtn").onclick = closeSheet;
  html.bind?.();
}

/** Bloque "Eliminar" con confirmación en dos pasos. */
export function deleteBlock(what, onConfirm) {
  if (!canWrite() || !open) return { html: "", bind: () => {} };
  const html = `<div class="sec"><h4>Eliminar</h4><div class="row">${
    open.confirmDel
      ? `<span class="note">¿Eliminar ${esc(what)}?</span><button class="danger" id="delYes">Sí, eliminar</button><button id="delNo">Cancelar</button>`
      : `<button class="danger" id="delBtn">Eliminar ${esc(what)}</button>`
  }</div></div>`;
  const bind = () => {
    if ($("delBtn")) $("delBtn").onclick = () => { open.confirmDel = true; drawSheet(true); };
    if ($("delNo")) $("delNo").onclick = () => { open.confirmDel = false; drawSheet(true); };
    if ($("delYes")) $("delYes").onclick = async () => (await mutate(onConfirm)) && closeSheet();
  };
  return { html, bind };
}

/**
 * Historial vertical: [{id, key, label, at, note}] con la duración hasta el siguiente.
 * Con `editPath` (p. ej. "/quotes/ID") cada renglón tiene "Corregir" para cambiar fecha y nota.
 */
export function timelineHtml(items, finalKey, editPath = null) {
  if (!items.length) return '<ol class="tl"><li><div class="note">Sin registros</div><span></span></li></ol>';
  const editable = editPath && canWrite();
  return `<ol class="tl">${items
    .map((h, i) => {
      const next = items[i + 1]?.at || (h.key !== finalKey ? new Date().toISOString() : null);
      if (editable && open?.editEvent === h.id) {
        return `<li><form class="grid ev-edit" data-ev-form="${h.id}" data-path="${esc(editPath)}">
          <div class="full"><b>${esc(h.label)}</b></div>
          <label>Fecha y hora<input id="ev_at" type="datetime-local" value="${toLocalInput(h.at)}" required></label>
          <label>Nota<input id="ev_note" maxlength="500" value="${esc(h.note)}"></label>
          <div class="row full"><button class="primary" type="submit">Guardar</button><button type="button" data-ev-cancel>Cancelar</button></div>
        </form><span></span></li>`;
      }
      return `<li><div><div>${esc(h.label)}</div><div class="when">${esc(fmtTs(h.at))}${h.note ? " · " + esc(h.note) : ""}${
        editable ? ` <button class="link small" data-ev-edit="${h.id}" aria-label="Corregir fecha de ${esc(h.label)}">Corregir</button>` : ""
      }</div></div>
        <span class="dur">${h.at && next ? fmtDur(h.at, next) : ""}</span></li>`;
    })
    .join("")}</ol>`;
}

// Corregir renglones del historial (delegado: sirve para muestras y cotizaciones).
document.addEventListener("click", (e) => {
  const edit = e.target.closest("[data-ev-edit]");
  if (edit && open) { open.editEvent = Number(edit.dataset.evEdit); drawSheet(true); $("ev_at")?.focus(); }
  if (e.target.closest("[data-ev-cancel]") && open) { open.editEvent = null; drawSheet(true); }
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-ev-form]");
  if (!form) return;
  e.preventDefault();
  const body = { at: fromLocalInput($("ev_at").value), note: $("ev_note").value.trim() };
  const res = await mutate(() => api(`${form.dataset.path}/events/${form.dataset.evForm}`, { method: "PATCH", body }));
  if (res && open) { open.editEvent = null; drawSheet(true); }
});

/** Campo "cuándo pasó" para registrar algo con fecha pasada. Sin tocar, vale "ahora". */
export function whenInput(id, label = "Fecha y hora") {
  const now = toLocalInput(new Date().toISOString());
  return `<label class="when-field">${esc(label)}<input id="${id}" type="datetime-local" value="${now}" data-initial="${now}"></label>`;
}

/** ISO del campo, o undefined si quedó en "ahora" (así el servidor usa su propia hora). */
export function whenValue(id) {
  const el = $(id);
  if (!el || !el.value || el.value === el.dataset.initial) return undefined;
  return fromLocalInput(el.value);
}

/** Sugerencias de pruebas del catálogo para un <input list="testList">. */
export const testDatalist = () =>
  `<datalist id="testList">${state.catalog.tests.map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>`;

export const matchesQuery = (...fields) => !state.query || fields.join(" ").toLowerCase().includes(state.query);

/** La CSP bloquea style="" en el HTML; los tamaños van en data-* y se aplican por el DOM. */
export function applySizes(root) {
  for (const el of root.querySelectorAll("[data-h]")) el.style.height = el.dataset.h;
  for (const el of root.querySelectorAll("[data-w]")) el.style.width = el.dataset.w;
  for (const el of root.querySelectorAll("[data-span]")) el.style.gridColumn = "span " + el.dataset.span;
}
