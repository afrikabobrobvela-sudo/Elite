import { addBusinessDays, businessDaysBetween, dueStatus } from "/business-days.js";

const API = "/api/v1";
const POLL_MS = 10_000;

let stages = [];
let stageIndex = {};
let role = null;
let items = [];
let etag = null;
let query = "";
let showAllDone = false;
let openId = null; // null: cerrado, "": nueva muestra, id: detalle
let confirmDel = false;
let pollTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const canWrite = () => role === "editor";

// --- API --------------------------------------------------------------------

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/session") {
    showLogin();
    throw new ApiError(401, "unauthenticated", "Inicia sesión");
  }
  if (res.status === 204 || res.status === 304) return { status: res.status, headers: res.headers };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error?.code, json.error?.message || "Error");
  return { status: res.status, headers: res.headers, ...json };
}

// --- Formato ----------------------------------------------------------------

const fmtTs = (t) =>
  t ? new Date(t).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "fecha no registrada";

function ago(t) {
  if (!t) return "tiempo no registrado";
  const ms = Date.now() - new Date(t).getTime();
  const h = ms / 36e5;
  if (h < 1) return Math.max(1, Math.round(ms / 6e4)) + " min";
  if (h < 24) return Math.round(h) + " h";
  const wd = businessDaysBetween(new Date(t), new Date());
  return wd + (wd === 1 ? " día hábil" : " días hábiles");
}

/** Duración entre dos instantes en días hábiles (fracción de día si fue el mismo día). */
function durDays(a, b) {
  const h = (new Date(b) - new Date(a)) / 36e5;
  if (h < 24) return Math.max(0, h) / 24;
  return businessDaysBetween(new Date(a), new Date(b));
}
function fmtDur(a, b) {
  if (!a || !b) return "";
  const h = (new Date(b) - new Date(a)) / 36e5;
  if (h < 24) return Math.max(0, Math.round(h)) + " h";
  return businessDaysBetween(new Date(a), new Date(b)) + " d háb.";
}

// --- Vista ------------------------------------------------------------------

function matches(m) {
  if (!query) return true;
  return [m.code, m.quote, m.client, m.test, m.standard, m.consultant, m.salesRep].join(" ").toLowerCase().includes(query);
}

function render() {
  const list = items.filter(matches);
  const active = items.filter((m) => m.stage !== "entregado");
  $("kActive").textContent = active.length;
  $("kLate").textContent = active.filter((m) => dueStatus(m).c === "late").length;
  $("kSoon").textContent = active.filter((m) => dueStatus(m).c === "warn").length;
  const cut = Date.now() - 30 * 864e5;
  $("kDone").textContent = items.filter((m) => m.stage === "entregado" && m.deliveredAt && new Date(m.deliveredAt).getTime() >= cut).length;

  $("board").innerHTML = stages
    .map((s, i) => {
      let cards = list.filter((m) => m.stage === s.key);
      const total = cards.length;
      if (s.key === "entregado") cards.sort((x, y) => String(y.deliveredAt || "").localeCompare(String(x.deliveredAt || "")));
      else cards.sort((x, y) => String(x.dueOn || "9").localeCompare(String(y.dueOn || "9")));
      let extra = "";
      if (s.key === "entregado" && !showAllDone && cards.length > 6) {
        extra = `<button class="more" data-more>Ver las ${cards.length} entregadas</button>`;
        cards = cards.slice(0, 6);
      }
      return `<section class="col${total ? "" : " is-empty"}" aria-label="${esc(s.name)}">
        <h2><span>${esc(s.name)} <small>${i + 1}/${stages.length}</small></span><span class="n">${total}</span></h2>
        <div class="who">${esc(s.owner)}</div>
        ${cards.length ? cards.map(card).join("") : `<div class="empty">Sin muestras</div>`}${extra}</section>`;
    })
    .join("");
  renderAverages();
}

function card(m) {
  const st = dueStatus(m);
  const since =
    m.stage === "entregado"
      ? m.deliveredAt ? "Entregado " + fmtTs(m.deliveredAt) : "Fecha de entrega no registrada"
      : "En esta etapa hace " + ago(m.stageSince);
  return `<article class="card s-${st.c}" tabindex="0" data-id="${esc(m.id)}">
    <div class="top"><span class="code">${esc(m.code || "Sin número")}</span><span class="chip ${st.c}">${esc(st.t)}</span></div>
    <div class="t">${esc(m.test)}</div>
    <div class="c">${esc(m.client || "Cliente sin registrar")}</div>
    <div class="since">${esc(since)}</div>
  </article>`;
}

/** Promedio de días hábiles que las muestras pasan en cada etapa (solo tramos con fecha de inicio y fin). */
function renderAverages() {
  const sums = Object.fromEntries(stages.map((s) => [s.key, { total: 0, n: 0 }]));
  for (const m of items) {
    const h = m.history || [];
    for (let i = 0; i < h.length - 1; i++) {
      if (!h[i].at || !h[i + 1].at || !sums[h[i].stage]) continue;
      sums[h[i].stage].total += durDays(h[i].at, h[i + 1].at);
      sums[h[i].stage].n++;
    }
  }
  $("avg").innerHTML = stages
    .filter((s) => s.key !== "entregado")
    .map((s) => {
      const { total, n } = sums[s.key];
      const v = n ? (total / n).toFixed(1) + " d" : "–";
      return `<div><b>${v}</b>${esc(s.name)}${n ? ` · ${n}` : ""}</div>`;
    })
    .join("");
}

// --- Panel de detalle -------------------------------------------------------

function closeSheet() {
  openId = null;
  confirmDel = false;
  $("sheetHost").innerHTML = "";
}
function openSheet(id) {
  openId = id;
  confirmDel = false;
  drawSheet();
}

function drawSheet() {
  if (openId === null) return;
  const isNew = openId === "";
  const m = isNew ? { stage: "recibido", history: [] } : items.find((x) => x.id === openId);
  if (!m) return closeSheet();
  // No redibujar mientras se escribe en el panel: se perdería lo capturado.
  const focused = document.activeElement;
  if (!isNew && focused && $("sheetHost").contains(focused) && /INPUT|SELECT|TEXTAREA/.test(focused.tagName)) return;

  const st = dueStatus(m);
  const hist = m.history || [];
  const tl = hist
    .map((h, i) => {
      const next = hist[i + 1]?.at || (h.stage !== "entregado" ? new Date().toISOString() : null);
      return `<li><div><div>${esc(stages[stageIndex[h.stage]]?.name || h.stage)}</div>
        <div class="when">${esc(fmtTs(h.at))}${h.note ? " · " + esc(h.note) : ""}</div></div>
        <span class="dur">${h.at && next ? fmtDur(h.at, next) : ""}</span></li>`;
    })
    .join("");
  const idx = stageIndex[m.stage] ?? 0;
  const nextS = stages[idx + 1];
  const dis = canWrite() ? "" : "disabled";
  const f = (k, label, type = "text", cls = "") =>
    `<label class="${cls}">${label}<input id="f_${k}" name="${k}" type="${type}" value="${esc(m[k] ?? "")}" ${dis}></label>`;

  $("sheetHost").innerHTML = `<div class="scrim" id="scrim"><aside class="sheet" role="dialog" aria-modal="true" aria-label="Detalle de muestra">
    <div class="row" style="justify-content:space-between">
      <h3>${isNew ? "Nueva muestra" : esc(m.code || "Sin número")}</h3><button id="closeBtn">Cerrar</button></div>
    ${isNew ? "" : `<div class="row"><span class="chip ${st.c}">${esc(st.t)}</span><span class="note">Etapa actual: <b>${esc(stages[idx].name)}</b>${m.stage !== "entregado" ? " desde hace " + esc(ago(m.stageSince)) : ""}</span></div>`}
    ${!isNew && canWrite() ? `<div class="sec"><h4>Cambiar etapa</h4><div class="row">
      ${nextS ? `<button class="primary" id="nextBtn">Pasar a ${esc(nextS.name)}</button>` : ""}
      <select id="stageSel" aria-label="Elegir etapa">${stages.map((s) => `<option value="${s.key}" ${s.key === m.stage ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <button id="setBtn">Mover</button></div>
      <input id="nota" maxlength="500" placeholder="Nota opcional (ej. cliente no ha dado VoBo)" aria-label="Nota del cambio"></div>` : ""}
    ${isNew ? "" : `<div class="sec"><h4>Historial de etapas</h4><ol class="tl">${tl || '<li><div class="note">Sin registros</div><span></span></li>'}</ol></div>`}
    <div class="sec"><h4>Datos</h4>
    <form class="grid" id="dataForm">
      ${f("code", "Muestra")}${f("quote", "Cotización")}
      ${f("client", "Cliente", "text", "full")}
      ${f("test", "Prueba")}${f("standard", "Norma")}
      ${f("consultant", "Consultor")}${f("salesRep", "Vendedor")}
      ${f("receivedOn", "Recepción de probetas", "date")}${f("businessDays", "Días hábiles comprometidos", "number")}
      ${f("dueOn", "Fecha compromiso", "date", "full")}
      ${isNew ? `<label class="full">Etapa inicial<select id="f_stage">${stages.slice(0, -1).map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join("")}</select></label>` : ""}
      ${canWrite() ? `<div class="row full"><button class="primary" type="submit">${isNew ? "Agregar muestra" : "Guardar datos"}</button><span class="note" id="saveMsg" role="status"></span></div>` : ""}
    </form></div>
    ${!isNew && canWrite() ? `<div class="sec"><h4>Eliminar</h4><div class="row">${
      confirmDel
        ? `<span class="note">¿Eliminar ${esc(m.code || "esta muestra")} y su historial?</span><button class="danger" id="delYes">Sí, eliminar</button><button id="delNo">Cancelar</button>`
        : `<button class="danger" id="delBtn">Eliminar muestra</button>`
    }</div></div>` : ""}
  </aside></div>`;

  $("scrim").addEventListener("click", (e) => e.target.id === "scrim" && closeSheet());
  $("closeBtn").onclick = closeSheet;
  if ($("nextBtn")) $("nextBtn").onclick = () => moveTo(m, nextS.key);
  if ($("setBtn")) $("setBtn").onclick = () => $("stageSel").value !== m.stage && moveTo(m, $("stageSel").value);
  if ($("delBtn")) $("delBtn").onclick = () => { confirmDel = true; drawSheet(); };
  if ($("delNo")) $("delNo").onclick = () => { confirmDel = false; drawSheet(); };
  if ($("delYes")) $("delYes").onclick = () => mutate(() => api(`/samples/${m.id}`, { method: "DELETE" })).then((ok) => ok && closeSheet());

  const rec = $("f_receivedOn"), dh = $("f_businessDays"), due = $("f_dueOn");
  const auto = () => {
    if (rec.value && dh.value && !due.dataset.touched) due.value = addBusinessDays(rec.value, Number(dh.value));
  };
  rec.addEventListener("change", auto);
  dh.addEventListener("change", auto);
  due.addEventListener("input", () => (due.dataset.touched = "1"));

  $("dataForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canWrite()) return;
    const body = {};
    for (const k of ["code", "quote", "client", "test", "standard", "consultant", "salesRep"]) body[k] = $("f_" + k).value.trim();
    for (const k of ["receivedOn", "dueOn"]) body[k] = $("f_" + k).value || null;
    body.businessDays = dh.value ? Number(dh.value) : null;
    if (isNew) {
      body.stage = $("f_stage").value;
      const res = await mutate(() => api("/samples", { method: "POST", body }));
      if (res) {
        openId = res.data.id;
        drawSheet();
      }
    } else {
      const res = await mutate(() => api(`/samples/${m.id}`, { method: "PATCH", body }));
      if (res && $("saveMsg")) $("saveMsg").textContent = "Guardado";
    }
  });
}

async function moveTo(m, stage) {
  const note = ($("nota")?.value || "").trim();
  document.activeElement?.blur();
  await mutate(() => api(`/samples/${m.id}/stage-changes`, { method: "POST", body: { stage, note: note || undefined } }));
}

/** Ejecuta una escritura, muestra el error si falla y refresca el tablero. */
async function mutate(fn) {
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

function showError(e) {
  if (e.status === 401) return;
  const b = $("banner");
  b.hidden = false;
  b.textContent =
    e.status === 403 ? "Tu acceso es de solo lectura; no puedes cambiar datos." :
    e.status === 422 ? "Revisa los datos: " + e.message :
    "No se pudo guardar el cambio. Revisa tu conexión e inténtalo de nuevo.";
}

// --- Sincronización en vivo -------------------------------------------------

function setLive(state) {
  const l = $("live");
  l.classList.toggle("on", state === "on");
  l.classList.toggle("off", state === "off");
  $("liveTxt").textContent = state === "on" ? "En vivo" : state === "off" ? "Sin conexión" : "Conectando…";
}

async function refresh() {
  try {
    const res = await api("/samples", { headers: etag ? { "If-None-Match": etag } : {} });
    setLive("on");
    if (res.status === 304) return;
    etag = res.headers.get("ETag");
    items = res.data;
    render();
    drawSheet();
  } catch (e) {
    if (e.status !== 401) setLive("off");
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => !document.hidden && refresh(), POLL_MS);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

document.addEventListener("visibilitychange", () => !document.hidden && role && refresh());

// --- Sesión -----------------------------------------------------------------

function showLogin() {
  role = null;
  stopPolling();
  closeSheet();
  $("boardView").hidden = true;
  $("loginView").hidden = false;
  $("password").focus();
}

async function showBoard(r) {
  role = r;
  $("loginView").hidden = true;
  $("boardView").hidden = false;
  $("addBtn").hidden = !canWrite();
  if (!stages.length) {
    stages = (await api("/stages")).data;
    stageIndex = Object.fromEntries(stages.map((s, i) => [s.key, i]));
  }
  etag = null;
  await refresh();
  startPolling();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";
  try {
    const res = await api("/session", { method: "POST", body: { password: $("password").value } });
    $("password").value = "";
    await showBoard(res.data.role);
  } catch (err) {
    $("loginError").textContent = err.status === 401 ? "Contraseña incorrecta." : err.message;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/session", { method: "DELETE" }).catch(() => {});
  items = [];
  showLogin();
});

document.addEventListener("click", (e) => {
  const c = e.target.closest(".card");
  if (c) return openSheet(c.dataset.id);
  if (e.target.closest("[data-more]")) {
    showAllDone = true;
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList?.contains("card")) openSheet(e.target.dataset.id);
  if (e.key === "Escape" && openId !== null) closeSheet();
});
$("q").addEventListener("input", (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});
$("addBtn").addEventListener("click", () => openSheet(""));
setInterval(() => role && render(), 60_000); // refresca los "hace X" aunque no haya cambios

(async () => {
  try {
    const res = await api("/session");
    await showBoard(res.data.role);
  } catch {
    showLogin();
  }
})();
