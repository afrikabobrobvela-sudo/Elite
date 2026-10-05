// Mi productividad: carga actual, horas por actividad, gráficas y línea del tiempo.
import { businessDaysBetween } from "/business-days.js";
import {
  $, activityMs, activityTypeOf, applySizes, esc, fmtDayLabel, fmtHours, fmtTime, isMine, quoteById, quoteStatusOf,
  sampleById, stageOf, state,
} from "./core.js";
import { adminSpan } from "./quotes.js";

let periodDays = 7;
let timelineFilter = "todo";

const DAY = 864e5;
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
/** Lunes de la semana de t. */
const startOfWeek = (t) => {
  const d = startOfDay(t);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmtAvgDays = (v) => (v === null ? "–" : `${v.toFixed(1)} d`);

function periodStart() {
  return startOfDay(Date.now() - (periodDays - 1) * DAY);
}

/** Eventos de etapa de muestras y de cotizaciones dentro del periodo. */
function eventsInRange(from) {
  const out = [];
  for (const s of state.samples)
    for (const h of s.history) if (h.at && new Date(h.at) >= from) out.push({ kind: "sample", at: h.at, sample: s, ev: h });
  for (const q of state.quotes)
    for (const h of q.history) if (h.at && new Date(h.at) >= from) out.push({ kind: "quote", at: h.at, quote: q, ev: h });
  return out;
}

export function renderProductivity() {
  for (const b of document.querySelectorAll("[data-period]")) b.setAttribute("aria-pressed", String(Number(b.dataset.period) === periodDays));
  const from = periodStart();
  const now = Date.now();
  const acts = state.activities.filter((a) => new Date(a.startedAt) >= from);
  const groupMs = { admin: 0, eval: 0, otro: 0 };
  const typeMs = {};
  for (const a of acts) {
    const t = activityTypeOf(a.type);
    const ms = activityMs(a, now);
    groupMs[t?.group ?? "otro"] += ms;
    typeMs[a.type] = (typeMs[a.type] ?? 0) + ms;
  }
  const totalMs = groupMs.admin + groupMs.eval + groupMs.otro;
  const pct = (ms) => (totalMs ? Math.round((100 * ms) / totalMs) + "%" : "–");

  // Carga actual
  const active = state.samples.filter((s) => s.stage !== "entregado");
  $("pMine").textContent = active.filter(isMine).length;
  $("pWaiting").textContent = active.filter((s) => !isMine(s)).length;
  $("pQuotes").textContent = state.quotes.filter((q) => ["elaboracion", "seguimiento"].includes(q.status)).length;

  // Periodo
  const events = eventsInRange(from);
  $("pHours").textContent = fmtHours(totalMs);
  $("pAdminPct").textContent = pct(groupMs.admin);
  $("pEvalPct").textContent = pct(groupMs.eval);
  $("pSent").textContent = events.filter((e) => e.kind === "quote" && e.ev.status === "enviada").length;
  $("pReceived").textContent = events.filter((e) => e.kind === "sample" && e.ev.stage === "recibido").length;
  $("pDelivered").textContent = events.filter((e) => e.kind === "sample" && e.ev.stage === "entregado").length;

  // Ciclos: administrativo (cotización o VoBo → consultor) y de evaluación (consultor → entregado), en días hábiles.
  const adminCycles = [];
  const evalCycles = [];
  for (const s of state.samples) {
    const rec = s.history.find((h) => h.stage === "recibido" && h.at);
    const done = s.history.find((h) => h.stage === "entregado" && h.at);
    if (rec && new Date(rec.at) >= from && s.adminByMe) {
      const q = s.quoteId && quoteById(s.quoteId);
      const start = q ? adminSpan(q).from : s.history.find((h) => h.at)?.at;
      if (start && start < rec.at) adminCycles.push(businessDaysBetween(new Date(start), new Date(rec.at)));
    }
    if (rec && done && new Date(done.at) >= from && rec.at < done.at) {
      evalCycles.push(businessDaysBetween(new Date(rec.at), new Date(done.at)));
    }
  }
  $("pAdminCycle").textContent = fmtAvgDays(avg(adminCycles));
  $("pEvalCycle").textContent = fmtAvgDays(avg(evalCycles));

  renderStackedChart(acts, from, now);
  renderTypeBars(typeMs, totalMs);
  renderTimeline(acts, events);
}

// --- Gráfica 1: horas por día (o semana) apiladas por grupo ---------------------------------

const GROUPS = ["admin", "eval", "otro"];

function renderStackedChart(acts, from, now) {
  const weekly = periodDays > 31;
  const buckets = [];
  for (const d = weekly ? startOfWeek(from) : startOfDay(from); d.getTime() <= now; d.setDate(d.getDate() + (weekly ? 7 : 1))) {
    buckets.push({ d: new Date(d), ms: { admin: 0, eval: 0, otro: 0 } });
  }
  const keyOf = (t) => (weekly ? startOfWeek(t) : startOfDay(t)).getTime();
  const byKey = new Map(buckets.map((b) => [b.d.getTime(), b]));
  for (const a of acts) {
    const b = byKey.get(keyOf(a.startedAt));
    if (b) b.ms[activityTypeOf(a.type)?.group ?? "otro"] += activityMs(a, now);
  }
  const maxH = Math.max(1, ...buckets.map((b) => (b.ms.admin + b.ms.eval + b.ms.otro) / 36e5));
  const top = Math.ceil(maxH / 2) * 2; // tope par para que la línea media caiga en entero
  const names = Object.fromEntries(state.catalog.activityGroups.map((g) => [g.key, g.name]));
  const label = (d) => (weekly ? `Sem. ${d.getDate()}/${d.getMonth() + 1}` : d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric" }));
  const showEvery = buckets.length > 14 ? Math.ceil(buckets.length / 10) : 1;

  $("chartHours").innerHTML = `
    <div class="legend">${GROUPS.map((g) => `<span><i class="sw g-${g}"></i>${esc(names[g])}</span>`).join("")}</div>
    <div class="stack-chart">
      <div class="yaxis"><span>${top} h</span><span>${top / 2} h</span><span>0</span></div>
      <div class="plot">
        ${buckets
          .map((b, i) => {
            const total = b.ms.admin + b.ms.eval + b.ms.otro;
            const tip = `${label(b.d)}: ${GROUPS.map((g) => `${names[g]} ${fmtHours(b.ms[g])}`).join(" · ")} · Total ${fmtHours(total)}`;
            const segs = GROUPS.filter((g) => b.ms[g] > 0)
              .map((g) => `<i class="seg g-${g}" data-h="${((100 * b.ms[g]) / 36e5 / top).toFixed(2)}%"></i>`)
              .join("");
            return `<div class="bar" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}"><div class="segs">${segs}</div>
              <span class="xl">${i % showEvery === 0 ? esc(label(b.d)) : ""}</span></div>`;
          })
          .join("")}
      </div>
    </div>
    <details class="tableview"><summary>Ver como tabla</summary>
      <table><thead><tr><th>${weekly ? "Semana" : "Día"}</th>${GROUPS.map((g) => `<th>${esc(names[g])}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${buckets.map((b) => `<tr><td>${esc(label(b.d))}</td>${GROUPS.map((g) => `<td>${fmtHours(b.ms[g])}</td>`).join("")}<td>${fmtHours(b.ms.admin + b.ms.eval + b.ms.otro)}</td></tr>`).join("")}</tbody></table>
    </details>`;
  applySizes($("chartHours"));
}

// --- Gráfica 2: horas por tipo de actividad ---------------------------------------------

function renderTypeBars(typeMs, totalMs) {
  const rows = state.catalog.activityTypes
    .map((t) => ({ t, ms: typeMs[t.key] ?? 0 }))
    .filter((r) => r.ms > 0)
    .sort((a, b) => b.ms - a.ms);
  const max = Math.max(1, ...rows.map((r) => r.ms));
  $("chartTypes").innerHTML = rows.length
    ? `<div class="hbars">${rows
        .map(
          (r) => `<div class="hrow" data-tip="${esc(`${r.t.name}: ${fmtHours(r.ms)} (${Math.round((100 * r.ms) / totalMs)}%)`)}">
            <span class="hname">${esc(r.t.name)}</span>
            <span class="htrack"><i class="g-${r.t.group}" data-w="${((100 * r.ms) / max).toFixed(1)}%"></i></span>
            <span class="hval">${fmtHours(r.ms)}</span></div>`,
        )
        .join("")}</div>`
    : `<p class="note">Aún no hay tiempo registrado en este periodo. Usa la barra de arriba para iniciar una actividad.</p>`;
  applySizes($("chartTypes"));
}

// --- Línea del tiempo -------------------------------------------------------------------

function renderTimeline(acts, events) {
  const items = [
    ...(timelineFilter === "todo" || timelineFilter === "tiempo" ? acts.map((a) => ({ kind: "act", at: a.startedAt, a })) : []),
    ...events.filter((e) => timelineFilter === "todo" || (timelineFilter === "muestras" && e.kind === "sample") || (timelineFilter === "cotizaciones" && e.kind === "quote")),
  ].sort((x, y) => y.at.localeCompare(x.at));
  for (const b of document.querySelectorAll("[data-tlfilter]")) b.setAttribute("aria-pressed", String(b.dataset.tlfilter === timelineFilter));

  const days = new Map();
  for (const it of items.slice(0, 300)) {
    const k = startOfDay(it.at).getTime();
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(it);
  }
  $("timeline").innerHTML = days.size
    ? [...days]
        .map(
          ([k, list]) => `<section class="tday"><h5>${esc(fmtDayLabel(new Date(k)))}</h5><ul>${list.map(item).join("")}</ul></section>`,
        )
        .join("")
    : `<p class="note">Sin movimientos en este periodo.</p>`;
}

function item(it) {
  if (it.kind === "act") {
    const a = it.a;
    const t = activityTypeOf(a.type);
    const link = (a.quoteId && quoteById(a.quoteId)?.number) || (a.sampleId && sampleById(a.sampleId)?.code) || "";
    return `<li class="ti" data-open="activity" data-id="${esc(a.id)}"><i class="dot g-${t?.group ?? "otro"}"></i>
      <span class="tt">${esc(fmtTime(a.startedAt))}${a.endedAt ? "–" + esc(fmtTime(a.endedAt)) : " · en curso"}</span>
      <span><b>${esc(t?.name)}</b> · ${fmtHours(activityMs(a))}${link ? ` · ${esc(link)}` : ""}${a.note ? ` · <span class="note">${esc(a.note)}</span>` : ""}</span></li>`;
  }
  if (it.kind === "sample") {
    const s = it.sample;
    return `<li class="ti" data-open="sample" data-id="${esc(s.id)}"><i class="dot ev"></i><span class="tt">${esc(fmtTime(it.at))}</span>
      <span>Muestra <b>${esc(s.code || "sin número")}</b> pasó a ${esc(stageOf(it.ev.stage)?.name)}${it.ev.note ? ` · <span class="note">${esc(it.ev.note)}</span>` : ""}</span></li>`;
  }
  const q = it.quote;
  return `<li class="ti" data-open="quote" data-id="${esc(q.id)}"><i class="dot ev"></i><span class="tt">${esc(fmtTime(it.at))}</span>
    <span>Cotización <b>${esc(q.number || "sin número")}</b>: ${esc(quoteStatusOf(it.ev.status)?.name)}${it.ev.note ? ` · <span class="note">${esc(it.ev.note)}</span>` : ""}</span></li>`;
}

export function bindProductivityControls() {
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-period]");
    if (p) { periodDays = Number(p.dataset.period); renderProductivity(); }
    const f = e.target.closest("[data-tlfilter]");
    if (f) { timelineFilter = f.dataset.tlfilter; renderProductivity(); }
  });
  // Ayuda emergente de las gráficas.
  const tip = $("tip");
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2)) + "px";
    tip.style.top = Math.max(8, y - r.height - 12) + "px";
  };
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener("focusout", () => (tip.hidden = true));
}

