// Módulo administrativo: cotizaciones, de la elaboración a la compra, y sus muestras.
import { businessDaysBetween } from "/business-days.js";
import {
  $, activityMs, activityTypeOf, ago, api, canWrite, deleteBlock, esc, fmtHours, fmtTs, matchesQuery, mutate,
  openSheet, quoteStatusOf, registerSheet, stageOf, state, timelineHtml,
} from "./core.js";

const OPEN = ["elaboracion", "enviada", "seguimiento"];

/** Muestras de una cotización. */
export const samplesOf = (q) => state.samples.filter((s) => s.quoteId === q.id);

/**
 * Tiempo administrativo de una cotización: desde que se creó hasta que la primera
 * de sus muestras llegó al consultor (o hasta hoy si aún no llega).
 */
export function adminSpan(q) {
  const received = samplesOf(q)
    .flatMap((s) => s.history.filter((h) => h.stage === "recibido" && h.at).map((h) => h.at))
    .sort()[0];
  return { from: q.createdAt, to: received ?? null };
}

export function renderQuotes() {
  const list = state.quotes.filter((q) => matchesQuery(q.number, q.client, q.salesRep, q.tests, q.notes));
  const open = state.quotes.filter((q) => OPEN.includes(q.status));
  $("qOpen").textContent = open.length;
  $("qFollow").textContent = state.quotes.filter((q) => q.status === "seguimiento").length;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  $("qWon").textContent = state.quotes.filter((q) => q.status === "comprada" && q.statusSince && new Date(q.statusSince) >= monthStart).length;
  $("qWaiting").textContent = state.quotes.filter(
    (q) => q.status === "comprada" && samplesOf(q).some((s) => ["vobo", "maquinado", "probetas"].includes(s.stage)),
  ).length;

  $("quoteBoard").innerHTML = state.catalog.quoteStatuses
    .map((s) => {
      const cards = list.filter((q) => q.status === s.key).sort((a, b) => String(b.statusSince).localeCompare(String(a.statusSince)));
      return `<section class="col${cards.length ? "" : " is-empty"}" aria-label="${esc(s.name)}">
        <h2><span>${esc(s.name)}</span><span class="n">${cards.length}</span></h2>
        <div class="who">${esc(s.who)}</div>
        ${cards.length ? cards.map(card).join("") : `<div class="empty">Sin cotizaciones</div>`}</section>`;
    })
    .join("");
}

function card(q) {
  const samples = samplesOf(q);
  const span = adminSpan(q);
  return `<article class="card" tabindex="0" data-open="quote" data-id="${esc(q.id)}">
    <div class="top"><span class="code">${esc(q.number || "Sin número")}</span>${samples.length ? `<span class="chip done">${samples.length} muestra${samples.length === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="t">${esc(q.client || "Cliente sin registrar")}</div>
    ${q.tests ? `<div class="c">${esc(q.tests)}</div>` : ""}
    <div class="since">${OPEN.includes(q.status) ? "En este estado hace " + esc(ago(q.statusSince)) : q.status === "comprada" ? (span.to ? `Probetas al consultor en ${businessDaysBetween(new Date(span.from), new Date(span.to))} d háb.` : "Probetas aún no llegan al consultor") : esc(fmtTs(q.statusSince))}</div>
  </article>`;
}

export function bindQuoteControls() {
  $("addQuoteBtn").addEventListener("click", () => openSheet("quote"));
}

registerSheet("quote", (open) => {
  const isNew = !open.id;
  const q = isNew ? { status: "elaboracion", history: [] } : state.quotes.find((x) => x.id === open.id);
  if (!q) return null;
  const dis = canWrite() ? "" : "disabled";
  const statuses = state.catalog.quoteStatuses;
  const idx = statuses.findIndex((s) => s.key === q.status);
  const next = q.status === "perdida" ? null : statuses[idx + 1] && statuses[idx + 1].key !== "perdida" ? statuses[idx + 1] : null;
  const input = (k, label, cls = "") => `<label class="${cls}">${label}<input id="q_${k}" value="${esc(q[k] ?? "")}" ${dis}></label>`;
  const samples = isNew ? [] : samplesOf(q);
  const acts = isNew ? [] : state.activities.filter((a) => a.quoteId === q.id);
  const actMs = acts.reduce((t, a) => t + activityMs(a), 0);
  const span = isNew ? null : adminSpan(q);
  const del = deleteBlock(q.number || "esta cotización", () => api(`/quotes/${q.id}`, { method: "DELETE" }));

  const body = `
    ${isNew ? "" : `<div class="row"><span class="note">Estado: <b>${esc(quoteStatusOf(q.status).name)}</b> desde hace ${esc(ago(q.statusSince))}</span></div>`}
    ${!isNew && canWrite() ? `<div class="sec"><h4>Cambiar estado</h4><div class="row">
      ${next ? `<button class="primary" id="qNextBtn">Pasar a ${esc(next.name)}</button>` : ""}
      <select id="qStatusSel" aria-label="Elegir estado">${statuses.map((s) => `<option value="${s.key}" ${s.key === q.status ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <button id="qSetBtn">Mover</button></div>
      <input id="qNota" maxlength="500" placeholder="Nota opcional (ej. cliente pidió ajuste de precio)" aria-label="Nota del cambio"></div>` : ""}
    ${isNew ? "" : `<div class="sec"><h4>Tiempo administrativo</h4>
      <p class="note">${span.to
        ? `De la cotización a la entrega de probetas al consultor: <b>${businessDaysBetween(new Date(span.from), new Date(span.to))} días hábiles</b>.`
        : `Abierta hace ${esc(ago(span.from))}; sus probetas todavía no llegan al consultor.`}
        Tiempo que registraste en esta cotización: <b>${fmtHours(actMs)}</b>.</p></div>`}
    ${isNew ? "" : `<div class="sec"><h4>Muestras de esta cotización</h4>
      ${samples.length ? `<ul class="plain">${samples.map((s) => `<li><button class="link" data-open="sample" data-id="${esc(s.id)}">${esc(s.code || "Sin número")}</button> · ${esc(s.test)} · <b>${esc(stageOf(s.stage).name)}</b></li>`).join("")}</ul>` : `<p class="note">Todavía no hay muestras. Agrégalas cuando el cliente compre.</p>`}
      ${canWrite() ? `<div class="row"><button id="qAddSample">Agregar muestra de esta cotización</button></div>` : ""}</div>`}
    ${isNew ? "" : `<div class="sec"><h4>Historial</h4>${timelineHtml(q.history.map((h) => ({ key: h.status, label: quoteStatusOf(h.status)?.name || h.status, at: h.at, note: h.note })), "perdida")}</div>`}
    ${acts.length ? `<div class="sec"><h4>Tiempo registrado</h4><ul class="plain">${acts.map((a) => `<li>${esc(activityTypeOf(a.type)?.name)} · ${fmtHours(activityMs(a))} · <span class="note">${esc(fmtTs(a.startedAt))}</span></li>`).join("")}</ul></div>` : ""}
    <div class="sec"><h4>Datos</h4>
    <form class="grid" id="quoteForm">
      ${input("number", "Número de cotización")}${input("salesRep", "Vendedor")}
      ${input("client", "Cliente", "full")}
      <label class="full">Pruebas solicitadas<textarea id="q_tests" rows="2" ${dis}>${esc(q.tests ?? "")}</textarea></label>
      <label class="full">Notas<textarea id="q_notes" rows="2" ${dis}>${esc(q.notes ?? "")}</textarea></label>
      ${canWrite() ? `<div class="row full"><button class="primary" type="submit">${isNew ? "Agregar cotización" : "Guardar datos"}</button><span class="note" id="qSaveMsg" role="status"></span></div>` : ""}
    </form></div>
    ${isNew ? "" : del.html}`;

  const bind = () => {
    del.bind();
    const moveTo = async (status) => {
      const note = ($("qNota")?.value || "").trim();
      document.activeElement?.blur();
      await mutate(() => api(`/quotes/${q.id}/status-changes`, { method: "POST", body: { status, note: note || undefined } }));
    };
    if ($("qNextBtn")) $("qNextBtn").onclick = () => moveTo(next.key);
    if ($("qSetBtn")) $("qSetBtn").onclick = () => $("qStatusSel").value !== q.status && moveTo($("qStatusSel").value);
    if ($("qAddSample")) $("qAddSample").onclick = () => openSheet("sample", "", { quoteId: q.id });
    $("quoteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!canWrite()) return;
      const body = {};
      for (const k of ["number", "salesRep", "client", "tests", "notes"]) body[k] = $("q_" + k).value.trim();
      if (isNew) {
        const res = await mutate(() => api("/quotes", { method: "POST", body }));
        if (res) openSheet("quote", res.data.id);
      } else {
        const res = await mutate(() => api(`/quotes/${q.id}`, { method: "PATCH", body }));
        if (res && $("qSaveMsg")) $("qSaveMsg").textContent = "Guardado";
      }
    });
  };

  return { label: "Detalle de cotización", title: isNew ? "Nueva cotización" : q.number || "Sin número", body, bind };
});
