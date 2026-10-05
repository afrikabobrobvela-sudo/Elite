// Arranque: sesión, pestañas y sincronización en vivo.
import { renderActivityBar } from "./js/activities.js";
import { $, api, closeSheet, drawSheet, openSheet, setRefresher, setUnauthorizedHandler, state } from "./js/core.js";
import { bindProductivityControls, renderProductivity } from "./js/productivity.js";
import { bindQuoteControls, renderQuotes } from "./js/quotes.js";
import { bindSampleControls, renderSamples } from "./js/samples.js";

const POLL_MS = 10_000;
const VIEWS = ["muestras", "cotizaciones", "productividad"];
let pollTimer = null;

function render() {
  if (!state.catalog) return;
  renderActivityBar();
  for (const v of VIEWS) {
    $("view-" + v).hidden = state.view !== v;
    const tab = $("tab-" + v);
    tab.setAttribute("aria-selected", String(state.view === v));
    tab.tabIndex = state.view === v ? 0 : -1;
  }
  if (state.view === "muestras") renderSamples();
  if (state.view === "cotizaciones") renderQuotes();
  if (state.view === "productividad") renderProductivity();
}

function setLive(s) {
  const l = $("live");
  l.classList.toggle("on", s === "on");
  l.classList.toggle("off", s === "off");
  $("liveTxt").textContent = s === "on" ? "En vivo" : s === "off" ? "Sin conexión" : "Conectando…";
}

async function refresh() {
  try {
    const res = await api("/board", { headers: state.etag ? { "If-None-Match": state.etag } : {} });
    setLive("on");
    if (res.status === 304) return;
    state.etag = res.headers.get("ETag");
    Object.assign(state, res.data);
    render();
    drawSheet();
  } catch (e) {
    if (e.status !== 401) setLive("off");
  }
}
setRefresher(refresh);

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => !document.hidden && refresh(), POLL_MS);
}

function showLogin() {
  state.role = null;
  clearInterval(pollTimer);
  closeSheet();
  $("boardView").hidden = true;
  $("loginView").hidden = false;
  $("password").focus();
}
setUnauthorizedHandler(showLogin);

async function showBoard(role) {
  state.role = role;
  $("loginView").hidden = true;
  $("boardView").hidden = false;
  for (const el of document.querySelectorAll("[data-editor]")) el.hidden = role !== "editor";
  if (!state.catalog) state.catalog = (await api("/catalog")).data;
  const fromHash = location.hash.slice(1);
  if (VIEWS.includes(fromHash)) state.view = fromHash;
  state.etag = null;
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
  Object.assign(state, { samples: [], quotes: [], activities: [] });
  showLogin();
});

// Pestañas (con flechas del teclado, como pide el patrón de tabs accesibles).
function selectView(v) {
  state.view = v;
  history.replaceState(null, "", "#" + v);
  render();
}
for (const v of VIEWS) $("tab-" + v).addEventListener("click", () => selectView(v));
$("tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const i = VIEWS.indexOf(state.view);
  const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length];
  selectView(next);
  $("tab-" + next).focus();
});

// Abrir el detalle de cualquier tarjeta o renglón con data-open.
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-open]");
  if (el) openSheet(el.dataset.open, el.dataset.id);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset?.open && e.target.tagName !== "BUTTON") openSheet(e.target.dataset.open, e.target.dataset.id);
  if (e.key === "Escape") closeSheet();
});
$("q").addEventListener("input", (e) => {
  state.query = e.target.value.trim().toLowerCase();
  render();
});
document.addEventListener("visibilitychange", () => !document.hidden && state.role && refresh());
setInterval(() => state.role && render(), 60_000); // refresca los "hace X" aunque no haya cambios

bindSampleControls();
bindQuoteControls();
bindProductivityControls();

(async () => {
  try {
    const res = await api("/session");
    await showBoard(res.data.role);
  } catch {
    showLogin();
  }
})();
