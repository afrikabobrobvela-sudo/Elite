// Registro de tiempo: barra con cronómetro y panel para capturar o corregir bloques.
import {
  $, activityMs, activityTypeOf, api, canWrite, deleteBlock, esc, fmtClock, fmtTime, fromLocalInput, mutate, openSheet,
  quoteById, registerSheet, sampleById, state, toLocalInput,
} from "./core.js";

export const running = () => state.activities.find((a) => !a.endedAt);

const typeOptions = (selected) =>
  state.catalog.activityGroups
    .map(
      (g) => `<optgroup label="${esc(g.name)}">${state.catalog.activityTypes
        .filter((t) => t.group === g.key)
        .map((t) => `<option value="${t.key}" ${t.key === selected ? "selected" : ""}>${esc(t.name)}</option>`)
        .join("")}</optgroup>`,
    )
    .join("");

/** Opciones "vincular a": cotizaciones abiertas o compradas y muestras en proceso. */
function linkOptions(a = {}) {
  const quotes = state.quotes.filter((q) => q.status !== "perdida" || q.id === a.quoteId);
  const samples = state.samples.filter((s) => s.stage !== "entregado" || s.id === a.sampleId);
  return `<option value="">Sin vincular</option>
    ${quotes.length ? `<optgroup label="Cotizaciones">${quotes.map((q) => `<option value="q:${esc(q.id)}" ${q.id === a.quoteId ? "selected" : ""}>${esc(q.number || "Sin número")} · ${esc(q.client)}</option>`).join("")}</optgroup>` : ""}
    ${samples.length ? `<optgroup label="Muestras">${samples.map((s) => `<option value="s:${esc(s.id)}" ${s.id === a.sampleId ? "selected" : ""}>${esc(s.code || "Sin número")} · ${esc(s.test)}</option>`).join("")}</optgroup>` : ""}`;
}

const parseLink = (v) => ({ quoteId: v.startsWith("q:") ? v.slice(2) : null, sampleId: v.startsWith("s:") ? v.slice(2) : null });

function linkLabel(a) {
  const q = a.quoteId && quoteById(a.quoteId);
  const s = a.sampleId && sampleById(a.sampleId);
  return q ? q.number || "cotización" : s ? s.code || "muestra" : "";
}

let lastKey = "";

/** Barra superior: cronómetro en curso, o el formulario para iniciar uno. El jefe la ve de solo lectura. */
export function renderActivityBar() {
  const bar = $("activityBar");
  const a = running();
  const key = canWrite() + "|" + (a ? a.id + a.type + a.note + a.quoteId + a.sampleId : "none") + "|" + state.quotes.length + state.samples.length;
  if (key === lastKey && bar.innerHTML) return tick();
  // No redibujar mientras se escribe en la barra.
  if (bar.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return tick();
  lastKey = key;
  bar.hidden = !a && !canWrite();
  if (a) {
    const link = linkLabel(a);
    bar.innerHTML = `<span class="rec" aria-hidden="true"></span>
      <span><b>${esc(activityTypeOf(a.type)?.name)}</b>${link ? ` · ${esc(link)}` : ""}${a.note ? ` · <span class="note">${esc(a.note)}</span>` : ""}</span>
      <span class="note">desde ${esc(fmtTime(a.startedAt))}</span>
      <span class="clock" id="clock"></span>
      ${canWrite() ? `<button class="primary" id="stopAct">Terminar</button><button id="editAct">Corregir</button>` : ""}`;
    if (canWrite()) {
      $("stopAct").onclick = () => mutate(() => api(`/activities/${a.id}`, { method: "PATCH", body: { endedAt: new Date().toISOString() } }));
      $("editAct").onclick = () => openSheet("activity", a.id);
    }
  } else {
    bar.innerHTML = `<form id="startForm" class="row">
      <label class="sr" for="actType">Actividad</label>
      <select id="actType">${typeOptions("cotizacion")}</select>
      <label class="sr" for="actLink">Vincular a</label>
      <select id="actLink">${linkOptions()}</select>
      <input id="actNote" maxlength="500" placeholder="Nota (opcional)" aria-label="Nota de la actividad">
      <button class="primary" type="submit">Iniciar</button>
      <button type="button" id="manualAct">Registrar tiempo pasado</button>
    </form>`;
    $("startForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const body = { type: $("actType").value, note: $("actNote").value.trim(), ...parseLink($("actLink").value) };
      document.activeElement?.blur();
      mutate(() => api("/activities", { method: "POST", body }));
    });
    $("manualAct").onclick = () => openSheet("activity");
  }
  tick();
}

function tick() {
  const a = running();
  if (a && $("clock")) $("clock").textContent = fmtClock(activityMs(a));
}
setInterval(tick, 1000);

registerSheet("activity", (open) => {
  const isNew = !open.id;
  const a = isNew
    ? (() => {
        const end = new Date();
        const start = new Date(end.getTime() - 60 * 60 * 1000);
        return { type: "cotizacion", startedAt: start.toISOString(), endedAt: end.toISOString(), note: "" };
      })()
    : state.activities.find((x) => x.id === open.id);
  if (!a) return null;
  const del = deleteBlock("este registro", () => api(`/activities/${a.id}`, { method: "DELETE" }));
  const body = `
    <form class="grid" id="actForm">
      <label class="full">Actividad<select id="a_type" aria-label="Actividad">${typeOptions(a.type)}</select></label>
      <label>Inicio<input id="a_start" type="datetime-local" value="${toLocalInput(a.startedAt)}" required></label>
      <label>Fin<input id="a_end" type="datetime-local" value="${toLocalInput(a.endedAt)}"></label>
      <label class="full">Vincular a<select id="a_link" aria-label="Vincular a">${linkOptions(a)}</select></label>
      <label class="full">Nota<input id="a_note" maxlength="500" value="${esc(a.note)}"></label>
      <p class="note full">Deja el fin vacío si la actividad sigue en curso.</p>
      <div class="row full"><button class="primary" type="submit">${isNew ? "Guardar registro" : "Guardar cambios"}</button><span class="note" id="aMsg" role="status"></span></div>
    </form>
    ${isNew ? "" : del.html}`;
  const bind = () => {
    del.bind();
    $("actForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        type: $("a_type").value,
        startedAt: fromLocalInput($("a_start").value),
        endedAt: fromLocalInput($("a_end").value),
        note: $("a_note").value.trim(),
        ...parseLink($("a_link").value),
      };
      const res = isNew
        ? await mutate(() => api("/activities", { method: "POST", body: payload }))
        : await mutate(() => api(`/activities/${a.id}`, { method: "PATCH", body: payload }));
      if (res) openSheet("activity", res.data.id);
      if (res && $("aMsg")) $("aMsg").textContent = "Guardado";
    });
  };
  return { label: "Registro de tiempo", title: isNew ? "Registrar tiempo" : "Corregir registro", body, bind };
});

