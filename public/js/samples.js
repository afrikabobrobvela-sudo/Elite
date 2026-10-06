// Módulo de muestras: tablero por etapa y panel de detalle.
import { addBusinessDays, dueStatus } from "/business-days.js";
import {
  $, activityMs, activityTypeOf, ago, applySizes, api, canWrite, conditioningInfo, deleteBlock, esc, fmtHours, fmtTs,
  fromLocalInput, isMine, matchesQuery, mutate, openSheet, quoteById, registerSheet, stageIdx, stageOf, stages, state,
  testDatalist, timelineHtml, toLocalInput, turnLabel, whenInput, whenValue,
} from "./core.js";

let filter = "todas"; // todas | mias | otros
let showAllDone = false;

export function renderSamples() {
  const list = state.samples.filter(
    (m) =>
      matchesQuery(m.code, m.quote, m.client, m.test, m.standard, m.consultant, m.salesRep) &&
      (filter === "todas" || m.stage === "entregado" || (filter === "mias") === isMine(m)),
  );
  const active = state.samples.filter((m) => m.stage !== "entregado");
  $("sActive").textContent = active.length;
  $("sMine").textContent = active.filter(isMine).length;
  $("sLate").textContent = active.filter((m) => dueStatus(m).c === "late").length;
  $("sSoon").textContent = active.filter((m) => dueStatus(m).c === "warn").length;
  for (const b of document.querySelectorAll("[data-sfilter]")) b.setAttribute("aria-pressed", String(b.dataset.sfilter === filter));

  const cols = stages().map((s, i) => {
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
      <h2><span>${esc(s.name)} <small>${i + 1}/${stages().length}</small></span><span class="n">${total}</span></h2>
      <div class="who">${esc(s.who)}</div>
      ${cards.length ? cards.map(card).join("") : `<div class="empty">Sin muestras</div>`}${extra}</section>`;
  });
  const nAdmin = stages().filter((s) => s.phase === "admin").length;
  $("sampleBoard").innerHTML = `
    <div class="phase" data-span="${nAdmin}">Parte administrativa</div>
    <div class="phase eval" data-span="${stages().length - nAdmin}">Evaluación</div>
    ${cols.join("")}`;
  $("sampleBoard").style.setProperty("--cols", stages().length);
  applySizes($("sampleBoard"));
}

function card(m) {
  const st = dueStatus(m);
  const turn = turnLabel(m);
  const cond = m.stage === "acondicionando" ? conditioningInfo(m) : null;
  const since =
    m.stage === "entregado"
      ? m.deliveredAt ? "Entregado " + fmtTs(m.deliveredAt) : "Fecha de entrega no registrada"
      : "En esta etapa hace " + ago(m.stageSince);
  return `<article class="card s-${st.c}${turn && !turn.mine ? " waiting" : ""}" tabindex="0" data-open="sample" data-id="${esc(m.id)}">
    <div class="top"><span class="code">${esc(m.code || "Sin número")}</span><span class="chip ${st.c}">${esc(st.t)}</span></div>
    <div class="t">${esc(m.test || "Prueba sin definir")}</div>
    <div class="c">${esc(m.client || "Cliente sin registrar")}</div>
    ${cond ? `<div><span class="chip ${cond.c}">${esc(cond.t)}</span></div>` : ""}
    <div class="since">${esc(since)}</div>
    ${turn ? `<div class="turn${turn.mine ? " mine" : ""}">${esc(turn.t)}</div>` : ""}
  </article>`;
}

export function bindSampleControls() {
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-sfilter]");
    if (f) { filter = f.dataset.sfilter; renderSamples(); }
    if (e.target.closest("[data-more]")) { showAllDone = true; renderSamples(); }
  });
  $("addSampleBtn").addEventListener("click", () => openSheet("sample"));
}

// --- Panel de muestra -----------------------------------------------------------

registerSheet("sample", (open) => {
  const isNew = !open.id;
  const q = open.opts.quoteId ? quoteById(open.opts.quoteId) : null;
  const m = isNew
    ? { stage: "recibo_muestra", history: [], adminByMe: true, testByMe: true, quoteId: q?.id ?? null, quote: q?.number ?? "", client: q?.client ?? "", salesRep: q?.salesRep ?? "" }
    : state.samples.find((x) => x.id === open.id);
  if (!m) return null;

  const dis = canWrite() ? "" : "disabled";
  const st = dueStatus(m);
  const idx = Math.max(0, stageIdx(m.stage));
  const nextS = stages()[idx + 1];
  const cond = conditioningInfo(m);
  const showCond = !isNew && (idx >= stageIdx("recibido") || m.conditioningStart);
  const limit = state.catalog.conditioningLimits[m.test];
  const input = (k, label, type = "text", cls = "", value = m[k]) =>
    `<label class="${cls}">${label}<input id="f_${k}" type="${type}" value="${esc(value ?? "")}" ${dis}></label>`;
  const other = m.testByMe === false; // la prueba la hace otro consultor
  const linked = state.activities.filter((a) => a.sampleId === m.id);
  const linkedMs = linked.reduce((t, a) => t + activityMs(a), 0);

  // Cronómetro de la etapa (p. ej. el recibo de muestra): mide cuánto tardas en ella.
  const stageAct = !isNew && canWrite() && stageOf(m.stage)?.activity && activityTypeOf(stageOf(m.stage).activity);
  const run = state.activities.find((a) => !a.endedAt);
  const runningHere = run && run.sampleId === m.id;
  const byType = {};
  for (const a of linked) byType[a.type] = (byType[a.type] ?? 0) + activityMs(a);
  const timer = !isNew && canWrite() && (stageAct || runningHere)
    ? `<div class="sec"><h4>Cronómetro</h4><div class="row">${
        runningHere
          ? `<span class="note"><b>${esc(activityTypeOf(run.type)?.name)}</b> corriendo desde ${esc(fmtTs(run.startedAt))}</span><button class="primary" id="sStopTimer">Terminar</button>`
          : `<button class="primary" id="sStartTimer">Iniciar: ${esc(stageAct.name)}</button>`
      }</div>${stageAct && byType[stageAct.key] ? `<p class="note">Llevas ${fmtHours(byType[stageAct.key])} en ${esc(stageAct.name.toLowerCase())} de esta muestra.</p>` : ""}</div>`
    : "";

  const body = `
    ${isNew ? "" : `<div class="row"><span class="chip ${st.c}">${esc(st.t)}</span><span class="note">Etapa actual: <b>${esc(stageOf(m.stage).name)}</b>${m.stage !== "entregado" ? " desde hace " + esc(ago(m.stageSince)) : ""}</span></div>`}
    ${!isNew && canWrite() ? `<div class="sec"><h4>Cambiar etapa</h4><div class="row">
      ${nextS ? `<button class="primary" id="nextBtn">Pasar a ${esc(nextS.name)}</button>` : ""}
      <select id="stageSel" aria-label="Elegir etapa">${stages().map((s) => `<option value="${s.key}" ${s.key === m.stage ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <button id="setBtn">Mover</button></div>
      <div class="grid">
        ${whenInput("sAt", "Fecha y hora del cambio")}
        <label>Nota<input id="nota" aria-label="Nota del cambio" maxlength="500" placeholder="Opcional (ej. cliente no ha dado VoBo)"></label>
      </div></div>` : ""}
    ${timer}
    ${showCond ? `<div class="sec"><h4>Acondicionamiento</h4>
      <form class="grid" id="condForm">
        ${input("conditioningStart", "Inicio", "datetime-local", "", toLocalInput(m.conditioningStart))}
        ${input("conditioningEnd", "Fin", "datetime-local", "", toLocalInput(m.conditioningEnd))}
        <p class="note full">${cond ? `<span class="chip ${cond.c}">${esc(cond.t)}</span> ` : ""}${limit ? `Para ${esc(m.test)} el acondicionamiento dura de ${limit.minDays} a ${limit.maxDays} días.` : "Se anota solo al pasar a Acondicionando y al salir; puedes corregirlo aquí."}</p>
        ${canWrite() ? `<div class="row full"><button type="submit">Guardar acondicionamiento</button><span class="note" id="condMsg" role="status"></span></div>` : ""}
      </form></div>` : ""}
    ${isNew ? "" : `<div class="sec"><h4>Historial de etapas</h4>${timelineHtml(m.history.map((h) => ({ id: h.id, key: h.stage, label: stageOf(h.stage)?.name || h.stage, at: h.at, note: h.note })), "entregado", `/samples/${m.id}`)}</div>`}
    ${!isNew && linked.length ? `<div class="sec"><h4>Tiempo registrado en esta muestra: ${fmtHours(linkedMs)}</h4>
      <ul class="plain">${linked.map((a) => `<li>${esc(activityTypeOf(a.type)?.name)} · ${fmtHours(activityMs(a))} · <span class="note">${esc(fmtTs(a.startedAt))}</span></li>`).join("")}</ul></div>` : ""}
    <div class="sec"><h4>Datos</h4>
    <form class="grid" id="dataForm">
      ${input("code", "Muestra")}
      <label>Cotización<select id="f_quoteId" aria-label="Cotización" ${dis}><option value="">Sin vincular</option>${state.quotes.map((x) => `<option value="${esc(x.id)}" ${x.id === m.quoteId ? "selected" : ""}>${esc(x.number || "Sin número")} · ${esc(x.client)}</option>`).join("")}</select></label>
      ${input("quote", "Número de cotización")}
      ${input("client", "Cliente")}
      <label class="full">Prueba<input id="f_test" list="testList" maxlength="200" value="${esc(m.test ?? "")}" placeholder="Elige de la lista o escríbela" ${dis}></label>
      ${testDatalist()}
      ${input("standard", "Norma")}${input("consultant", "Consultor")}
      ${input("salesRep", "Vendedor")}
      ${input("receivedAt", other ? "Entregué probetas al consultor (fecha y hora)" : "Recepción de probetas (fecha y hora)", "datetime-local", "", toLocalInput(m.receivedAt))}
      ${input("businessDays", other ? "Días hábiles que pidió el consultor" : "Días hábiles comprometidos", "number")}
      ${input("dueOn", other ? "Reporte prometido para" : "Fecha compromiso", "date")}
      <fieldset class="full checks"><legend>¿Qué parte te toca?</legend>
        <label class="check"><input type="checkbox" id="f_adminByMe" ${m.adminByMe ? "checked" : ""} ${dis}> La parte administrativa (recibo, VoBo, maquinado, entrega de probetas)</label>
        <label class="check"><input type="checkbox" id="f_testByMe" ${m.testByMe ? "checked" : ""} ${dis}> Las pruebas y el reporte</label>
      </fieldset>
      ${isNew ? `<label>Etapa inicial<select id="f_stage" aria-label="Etapa inicial">${stages().slice(0, -1).map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join("")}</select></label>
        ${whenInput("f_at", "Desde cuándo está en esa etapa")}` : ""}
      ${canWrite() ? `<div class="row full"><button class="primary" type="submit">${isNew ? "Agregar muestra" : "Guardar datos"}</button><span class="note" id="saveMsg" role="status"></span></div>` : ""}
    </form></div>
    ${isNew ? "" : deleteBlock(m.code || "esta muestra", () => api(`/samples/${m.id}`, { method: "DELETE" })).html}`;

  const bind = () => {
    if (!isNew) deleteBlock(m.code || "esta muestra", () => api(`/samples/${m.id}`, { method: "DELETE" })).bind();
    const moveTo = async (stage) => {
      const note = ($("nota")?.value || "").trim();
      const at = whenValue("sAt");
      document.activeElement?.blur();
      await mutate(() => api(`/samples/${m.id}/stage-changes`, { method: "POST", body: { stage, note: note || undefined, at } }));
    };
    if ($("sStartTimer")) $("sStartTimer").onclick = () => mutate(() => api("/activities", { method: "POST", body: { type: stageAct.key, sampleId: m.id } }));
    if ($("sStopTimer")) $("sStopTimer").onclick = () => mutate(() => api(`/activities/${run.id}`, { method: "PATCH", body: { endedAt: new Date().toISOString() } }));
    if ($("nextBtn")) $("nextBtn").onclick = () => moveTo(nextS.key);
    if ($("setBtn")) $("setBtn").onclick = () => $("stageSel").value !== m.stage && moveTo($("stageSel").value);

    // Etapa inicial sugerida: si la parte administrativa no es tuya, la muestra te llega ya recibida.
    const initial = $("f_stage");
    const syncInitial = () => initial && (initial.value = $("f_adminByMe").checked ? "recibo_muestra" : "recibido");
    if (initial) { syncInitial(); $("f_adminByMe").addEventListener("change", syncInitial); }

    $("f_quoteId").addEventListener("change", (e) => {
      const sel = quoteById(e.target.value);
      if (!sel) return;
      $("f_quote").value = sel.number;
      if (!$("f_client").value) $("f_client").value = sel.client;
      if (!$("f_salesRep").value) $("f_salesRep").value = sel.salesRep;
    });

    const rec = $("f_receivedAt"), dh = $("f_businessDays"), due = $("f_dueOn");
    const auto = () => {
      if (rec.value && dh.value && !due.dataset.touched) due.value = addBusinessDays(rec.value.slice(0, 10), Number(dh.value));
    };
    rec.addEventListener("change", auto);
    dh.addEventListener("change", auto);
    due.addEventListener("input", () => (due.dataset.touched = "1"));

    $("condForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { conditioningStart: fromLocalInput($("f_conditioningStart").value), conditioningEnd: fromLocalInput($("f_conditioningEnd").value) };
      const res = await mutate(() => api(`/samples/${m.id}`, { method: "PATCH", body }));
      if (res && $("condMsg")) $("condMsg").textContent = "Guardado";
    });

    $("dataForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!canWrite()) return;
      const body = {};
      for (const k of ["code", "quote", "client", "standard", "consultant", "salesRep"]) body[k] = $("f_" + k).value.trim();
      body.test = $("f_test").value.trim();
      body.quoteId = $("f_quoteId").value || null;
      body.receivedAt = fromLocalInput(rec.value);
      body.dueOn = due.value || null;
      body.businessDays = dh.value ? Number(dh.value) : null;
      body.adminByMe = $("f_adminByMe").checked;
      body.testByMe = $("f_testByMe").checked;
      if (isNew) {
        body.stage = initial.value;
        body.at = whenValue("f_at");
        const res = await mutate(() => api("/samples", { method: "POST", body }));
        if (res) openSheet("sample", res.data.id);
      } else {
        const res = await mutate(() => api(`/samples/${m.id}`, { method: "PATCH", body }));
        if (res && $("saveMsg")) $("saveMsg").textContent = "Guardado";
      }
    });
  };

  return { label: "Detalle de muestra", title: isNew ? "Nueva muestra" : m.code || "Sin número", body, bind };
});

