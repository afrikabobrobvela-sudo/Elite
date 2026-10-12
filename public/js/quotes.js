// Módulo administrativo: cotizaciones, de la elaboración a la compra, y sus muestras.
import { businessDaysBetween } from "/business-days.js";
import {
  $, activityMs, activityTypeOf, ago, api, canWrite, deleteBlock, esc, fmtHours, fmtTs, fromLocalInput, matchesQuery,
  mutate, openSheet, quoteStatusOf, registerSheet, stageOf, state, testDatalist, timelineHtml, toLocalInput, turnLabel,
  whenInput, whenValue,
} from "./core.js";
import { readQuotePdf } from "./pdf-quote.js";

const OPEN = ["elaboracion", "enviada", "seguimiento"];
const AWAITING = ["enviada", "seguimiento"]; // ya está con el cliente y aún no compra

/** Último contacto con el cliente: el cambio de estado más reciente o un seguimiento registrado con el cronómetro. */
export function lastFollowUp(q) {
  const times = [
    ...q.history.map((h) => h.at),
    ...state.activities.filter((a) => a.quoteId === q.id && a.type === "seguimiento").map((a) => a.endedAt || a.startedAt),
  ].filter(Boolean);
  return times.sort().at(-1) ?? q.statusSince;
}

/** Días sin seguimiento si ya pasaron los del recordatorio (15); si no, null. */
export function followUpDue(q, now = Date.now()) {
  if (!AWAITING.includes(q.status)) return null;
  const last = lastFollowUp(q);
  if (!last) return null;
  const days = Math.floor((now - Date.parse(last)) / 864e5);
  return days >= state.catalog.followUpDays ? days : null;
}

export const quotesDue = () => state.quotes.filter((q) => followUpDue(q) !== null);

/** Partidas de la cotización en una línea: "Flamabilidad Horizontal ×5, FTIR ×2". */
const itemsText = (q) => (q.items ?? []).map((i) => `${i.test} ×${i.quantity}`).join(", ");

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

/** Columnas cerradas (compradas, no concretadas): se muestran las más recientes y el resto a pedido. */
const CLOSED_SHOWN = 8;
const showAllIn = new Set();

export function renderQuotes() {
  const list = state.quotes.filter((q) => matchesQuery(q.number, q.client, q.salesRep, q.tests, itemsText(q), q.notes));
  const open = state.quotes.filter((q) => OPEN.includes(q.status));
  $("qOpen").textContent = open.length;
  $("qFollow").textContent = quotesDue().length;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  $("qWon").textContent = state.quotes.filter((q) => q.status === "comprada" && q.statusSince && new Date(q.statusSince) >= monthStart).length;
  $("qWaiting").textContent = state.quotes.filter(
    (q) => q.status === "comprada" && samplesOf(q).some((s) => ["recibo_muestra", "vobo", "maquinado", "probetas"].includes(s.stage)),
  ).length;

  $("quoteBoard").innerHTML = state.catalog.quoteStatuses
    .map((s) => {
      // Las que piden seguimiento van primero.
      const cards = list
        .filter((q) => q.status === s.key)
        .sort((a, b) => (followUpDue(b) ?? -1) - (followUpDue(a) ?? -1) || String(b.statusSince).localeCompare(String(a.statusSince)));
      const closed = s.key === "comprada" || s.key === "perdida";
      const shown = closed && !showAllIn.has(s.key) ? cards.slice(0, CLOSED_SHOWN) : cards;
      const more = cards.length > shown.length ? `<button class="more" data-qmore="${s.key}">Ver las ${cards.length}</button>` : "";
      return `<section class="col${cards.length ? "" : " is-empty"}" aria-label="${esc(s.name)}">
        <h2><span>${esc(s.name)}</span><span class="n">${cards.length}</span></h2>
        <div class="who">${esc(s.who)}</div>
        ${cards.length ? shown.map(card).join("") : `<div class="empty">Sin cotizaciones</div>`}${more}</section>`;
    })
    .join("");
}

function card(q) {
  const samples = samplesOf(q);
  const span = adminSpan(q);
  const due = followUpDue(q);
  return `<article class="card${due !== null ? " s-warn" : ""}" tabindex="0" data-open="quote" data-id="${esc(q.id)}">
    <div class="top"><span class="code">${esc(q.number || "Sin número")}</span>${
      due !== null ? `<span class="chip warn">Seguimiento: ${due} d</span>` : samples.length ? `<span class="chip done">${samples.length} muestra${samples.length === 1 ? "" : "s"}</span>` : ""
    }</div>
    <div class="t">${esc(q.client || "Cliente sin registrar")}</div>
    ${q.items?.length ? `<div class="c">${esc(itemsText(q))}</div>` : q.tests ? `<div class="c">${esc(q.tests)}</div>` : ""}
    ${q.status === "comprada" && q.poReceivedAt ? `<div class="c">Orden de compra: ${esc(fmtTs(q.poReceivedAt))}</div>` : ""}
    <div class="since">${OPEN.includes(q.status) ? "En este estado hace " + esc(ago(q.statusSince)) : q.status === "comprada" ? (span.to ? `Probetas al consultor en ${businessDaysBetween(new Date(span.from), new Date(span.to))} d háb.` : "Probetas aún no llegan al consultor") : esc(fmtTs(q.statusSince))}</div>
  </article>`;
}

/** Renglón de una prueba de la cotización: etapa, de quién depende y fechas clave con otro consultor. */
function testRow(s) {
  const turn = turnLabel(s);
  const extra = !s.testByMe
    ? [s.receivedAt && `probetas entregadas ${fmtTs(s.receivedAt)}`, s.dueOn && `reporte prometido ${fmtTs(s.dueOn)}`].filter(Boolean).join(" · ")
    : "";
  return `<li><button class="link" data-open="sample" data-id="${esc(s.id)}">${esc(s.test || "Prueba sin definir")}</button>
    ${s.code ? ` · ${esc(s.code)}` : ""}${!s.testByMe && s.consultant ? ` · ${esc(s.consultant)}` : ""} · <b>${esc(stageOf(s.stage).name)}</b>${turn ? ` · ${esc(turn.t)}` : ""}
    ${extra ? `<div class="note">${esc(extra)}</div>` : ""}</li>`;
}

export function bindQuoteControls() {
  $("addQuoteBtn").addEventListener("click", () => openSheet("quote"));
  $("quoteBoard").addEventListener("click", (e) => {
    const m = e.target.closest("[data-qmore]");
    if (m) { showAllIn.add(m.dataset.qmore); renderQuotes(); }
  });
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
  const due = isNew ? null : followUpDue(q);
  const awaiting = AWAITING.includes(q.status);
  const dateInput = (id, label, value = "", required = false) =>
    `<label>${label}<input id="${id}" type="datetime-local" value="${value}" ${required ? "required" : ""}></label>`;

  const partidas = `<div class="sec"><h4>Partidas</h4>
      ${canWrite() ? `<div class="row"><button type="button" id="qiPdfBtn">Importar desde PDF</button><input type="file" accept="application/pdf" data-quote-pdf hidden>
        <span class="note">Lee el número, la fecha, la empresa y las partidas de la cotización.</span></div>` : ""}
      <div id="qItems"></div>
      ${canWrite() ? `<div class="grid item-add">
          <label class="full">Prueba de la partida<input id="qi_test" list="testList" maxlength="200" placeholder="Elige de la lista o escríbela"></label>
          ${testDatalist()}
          <label>Cantidad<input id="qi_qty" type="number" min="1" max="9999" value="1"></label>
          <div class="row end"><button type="button" id="qiAdd">Agregar partida</button></div>
        </div>
        <p class="note" id="qiMsg" role="status"></p>` : ""}</div>`;

  const body = `
    ${isNew ? "" : `<div class="row"><span class="note">Estado: <b>${esc(quoteStatusOf(q.status).name)}</b> desde hace ${esc(ago(q.statusSince))}</span></div>`}
    ${due !== null ? `<p class="remind"><span>Lleva <b>${due} días</b> sin seguimiento. Contacta al cliente y regístralo aquí.</span></p>` : ""}
    ${!isNew && canWrite() ? `<div class="sec"><h4>Cambiar estado</h4><div class="row">
      ${awaiting ? `<button class="primary" id="qFollowBtn">Registrar seguimiento</button>` : ""}
      ${next ? `<button class="${awaiting ? "" : "primary"}" id="qNextBtn">Pasar a ${esc(next.name)}</button>` : ""}
      <select id="qStatusSel" aria-label="Elegir estado">${statuses.map((s) => `<option value="${s.key}" ${s.key === q.status ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <button id="qSetBtn">Mover</button></div>
      <div class="grid">
        ${whenInput("qAt", "Fecha y hora del cambio")}
        <label>Nota<input id="qNota" aria-label="Nota del cambio" maxlength="500" placeholder="Opcional (ej. cliente pidió ajuste de precio)"></label>
      </div>
      <p class="note">Si fue otro día, cambia la fecha antes de mover. Las fechas ya registradas se corrigen en el historial.</p></div>` : ""}
    ${isNew ? "" : `<div class="sec"><h4>Tiempo administrativo</h4>
      <p class="note">${span.to
        ? `De la cotización a la entrega de probetas al consultor: <b>${businessDaysBetween(new Date(span.from), new Date(span.to))} días hábiles</b>.`
        : `Abierta hace ${esc(ago(span.from))}; sus probetas todavía no llegan al consultor.`}
        Tiempo que registraste en esta cotización: <b>${fmtHours(actMs)}</b>.</p></div>`}
    ${partidas}
    ${isNew ? "" : `<div class="sec"><h4>Pruebas de esta cotización</h4>
      ${samples.length ? `<ul class="plain tests">${samples.map(testRow).join("")}</ul>` : `<p class="note">Todavía no hay pruebas. Agrégalas aquí; cada una se sigue como muestra en el tablero.</p>`}
      ${canWrite() ? `<form class="grid" id="qTestForm">
          <label class="full">Prueba<input id="qt_test" list="testList" maxlength="200" required placeholder="Elige de la lista o escríbela"></label>
          <label>Consultor<input id="qt_consultant" maxlength="100" placeholder="Vacío si la haces tú"></label>
          <label>Muestra<input id="qt_code" maxlength="40" placeholder="Opcional"></label>
          <div class="row full"><button class="primary" type="submit">Agregar prueba</button><button type="button" id="qAddSample">Agregar con todos los datos</button></div>
        </form>
        <p class="note">Si pones otro consultor, la prueba queda como suya: registras cuándo le entregaste probetas y para cuándo prometió el reporte, y el tiempo cuenta como espera de otros.</p>` : ""}</div>`}
    ${isNew ? "" : `<div class="sec"><h4>Historial</h4>${timelineHtml(q.history.map((h) => ({ id: h.id, key: h.status, label: quoteStatusOf(h.status)?.name || h.status, at: h.at, note: h.note })), "perdida", `/quotes/${q.id}`)}</div>`}
    ${acts.length ? `<div class="sec"><h4>Tiempo registrado</h4><ul class="plain">${acts.map((a) => `<li>${esc(activityTypeOf(a.type)?.name)} · ${fmtHours(activityMs(a))} · <span class="note">${esc(fmtTs(a.startedAt))}</span></li>`).join("")}</ul></div>` : ""}
    <div class="sec"><h4>Datos</h4>
    <form class="grid" id="quoteForm" ${isNew ? "" : 'data-autosave="change"'}>
      ${isNew ? `<input type="hidden" id="q_items" value="[]">` : ""}
      ${input("number", "Número de cotización")}${input("salesRep", "Vendedor")}
      ${input("client", "Cliente", "full")}
      ${q.tests ? `<label class="full">Pruebas solicitadas (texto anterior a las partidas)<textarea id="q_tests" rows="2" ${dis}>${esc(q.tests)}</textarea></label>` : ""}
      <label class="full">Notas<textarea id="q_notes" rows="2" ${dis}>${esc(q.notes ?? "")}</textarea></label>
      ${isNew ? `<fieldset class="full dates"><legend>Fechas (si la cotización ya avanzó, llena las que apliquen)</legend><div class="grid">
          ${dateInput("n_emision", "Emisión", toLocalInput(new Date().toISOString()), true)}
          ${dateInput("n_enviada", "Envío al cliente")}
          ${dateInput("n_seguimiento", "Último seguimiento")}
          ${dateInput("n_comprada", "Compra (llegada de la orden de compra)")}
        </div></fieldset>`
        : `<label class="full">Llegada de la orden de compra<input id="q_poReceivedAt" type="datetime-local" value="${toLocalInput(q.poReceivedAt)}" ${dis}></label>`}
      ${!canWrite() ? "" : isNew ? `<div class="row full"><button class="primary" type="submit">Agregar cotización</button><span class="note" id="qSaveMsg" role="status"></span></div>` : `<p class="autosave-note full">Los cambios se guardan solos al terminar cada campo. <b id="qSaveMsg" role="status"></b></p>`}
    </form></div>
    ${isNew ? "" : del.html}`;

  const bind = () => {
    del.bind();
    const items = bindItems(q, isNew);
    bindPdfImport(q, isNew, items);
    const moveTo = async (status) => {
      const note = ($("qNota")?.value || "").trim();
      const at = whenValue("qAt");
      document.activeElement?.blur();
      await mutate(() => api(`/quotes/${q.id}/status-changes`, { method: "POST", body: { status, note: note || undefined, at } }));
    };
    if ($("qNextBtn")) $("qNextBtn").onclick = () => moveTo(next.key);
    if ($("qFollowBtn")) $("qFollowBtn").onclick = () => moveTo("seguimiento");
    if ($("qSetBtn")) $("qSetBtn").onclick = () => $("qStatusSel").value !== q.status && moveTo($("qStatusSel").value);
    if ($("qAddSample")) $("qAddSample").onclick = () => openSheet("sample", "", { quoteId: q.id });
    $("qTestForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const consultant = $("qt_consultant").value.trim();
      const mine = !consultant || /^rodrigo$/i.test(consultant);
      const body = {
        test: $("qt_test").value.trim(), code: $("qt_code").value.trim(), consultant: consultant || "Rodrigo",
        quoteId: q.id, quote: q.number, client: q.client, salesRep: q.salesRep, adminByMe: true, testByMe: mine,
      };
      await mutate(() => api("/samples", { method: "POST", body }));
    });
    $("quoteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!canWrite()) return;
      const body = {};
      for (const k of ["number", "salesRep", "client", "tests", "notes"]) if ($("q_" + k)) body[k] = $("q_" + k).value.trim();
      if (isNew) {
        body.items = JSON.parse($("q_items").value || "[]");
        // Alta con su recorrido: emisión y, si ya pasaron, envío, seguimiento y compra, en orden.
        const steps = [["enviada", "n_enviada"], ["seguimiento", "n_seguimiento"], ["comprada", "n_comprada"]]
          .map(([status, id]) => ({ status, at: fromLocalInput($(id).value) }))
          .filter((x) => x.at);
        const emision = fromLocalInput($("n_emision").value);
        const times = [emision, ...steps.map((x) => x.at)];
        if (times.some((t, i) => i && t < times[i - 1])) {
          $("qSaveMsg").textContent = "Las fechas deben ir en orden: emisión, envío, seguimiento, compra.";
          return;
        }
        if (times.some((t) => Date.parse(t) > Date.now() + 5 * 6e4)) {
          $("qSaveMsg").textContent = "Las fechas no pueden ser futuras.";
          return;
        }
        const res = await mutate(async () => {
          const created = await api("/quotes", { method: "POST", body: { ...body, at: emision } });
          for (const st of steps) await api(`/quotes/${created.data.id}/status-changes`, { method: "POST", body: st });
          return created;
        });
        if (res) openSheet("quote", res.data.id);
      } else {
        body.poReceivedAt = fromLocalInput($("q_poReceivedAt").value);
        const res = await mutate(() => api(`/quotes/${q.id}`, { method: "PATCH", body }));
        if (res && $("qSaveMsg")) $("qSaveMsg").textContent = "Guardado";
      }
    });
  };

  return { label: "Detalle de cotización", title: isNew ? "Nueva cotización" : q.number || "Sin número", body, bind };
});


/**
 * Partidas: una prueba y cuántas son. En una cotización que ya existe cada cambio se guarda al momento;
 * en una nueva viajan en un campo oculto del formulario (y en su borrador) hasta "Agregar cotización".
 */
function bindItems(q, isNew) {
  const hidden = $("q_items");
  let items = isNew ? JSON.parse(hidden.value || "[]") : [...(q.items ?? [])];
  const draw = () => {
    $("qItems").innerHTML = items.length
      ? `<ol class="plain items">${items.map((it, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(it.test)}</span>${
          canWrite()
            ? `<label class="qty">Cantidad<input type="number" min="1" max="9999" value="${it.quantity}" data-item-qty="${i}" aria-label="Cantidad de la partida ${i + 1}"></label>
               <button type="button" class="link small" data-item-del="${i}" aria-label="Quitar partida ${i + 1}">Quitar</button>`
            : `<span class="qty">${it.quantity}</span>`
        }</li>`).join("")}</ol>
        <p class="note">${items.length} partida${items.length === 1 ? "" : "s"} · ${items.reduce((t, it) => t + it.quantity, 0)} pruebas en total</p>`
      : `<p class="note">Sin partidas. Agrega cada prueba de la cotización con su cantidad.</p>`;
  };
  const save = async (next) => {
    if (isNew) {
      items = next;
      hidden.value = JSON.stringify(items);
      $("quoteForm").dataset.dirty = "1"; // para que se conserve como borrador
      draw();
      return true;
    }
    const res = await mutate(() => api(`/quotes/${q.id}`, { method: "PATCH", body: { items: next } }));
    if (res) items = next;
    draw();
    return !!res;
  };
  draw();
  const ctl = { save, get: () => items };
  if (!canWrite()) return ctl;
  const add = async () => {
    const test = $("qi_test").value.trim();
    const quantity = Number($("qi_qty").value);
    if (!test) return void ($("qiMsg").textContent = "Escribe o elige la prueba de la partida.");
    if (!Number.isInteger(quantity) || quantity < 1) return void ($("qiMsg").textContent = "La cantidad debe ser un número entero de 1 en adelante.");
    if (await save([...items, { test, quantity }])) {
      $("qi_test").value = "";
      $("qi_qty").value = "1";
      $("qiMsg").textContent = `Partida ${items.length} agregada.`;
      $("qi_test").focus();
    }
  };
  $("qiAdd").onclick = add;
  for (const id of ["qi_test", "qi_qty"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); add(); }
    });
  }
  $("qItems").addEventListener("click", (e) => {
    const b = e.target.closest("[data-item-del]");
    if (b) save(items.filter((_, i) => i !== Number(b.dataset.itemDel)));
  });
  $("qItems").addEventListener("change", (e) => {
    const i = e.target.dataset?.itemQty;
    if (i === undefined) return;
    const quantity = Number(e.target.value);
    if (!Number.isInteger(quantity) || quantity < 1) return void (e.target.value = items[i].quantity);
    save(items.map((it, k) => (k === Number(i) ? { ...it, quantity } : it)));
  });
  return ctl;
}

/**
 * Importar desde PDF. En una cotización nueva llena los campos vacíos y las partidas para revisarlas
 * antes de "Agregar cotización". En una existente guarda las partidas (y los datos que estaban vacíos).
 */
function bindPdfImport(q, isNew, items) {
  const file = document.querySelector("[data-quote-pdf]");
  if (!file) return;
  $("qiPdfBtn").onclick = () => file.click();
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    const msg = $("qiMsg");
    msg.textContent = "Leyendo el PDF…";
    let data;
    try {
      data = await readQuotePdf(f);
    } catch (e) {
      console.error(e);
      msg.textContent = "No pude abrir ese PDF. ¿Es la cotización original (no escaneada)?";
      return;
    }
    if (!data.items.length) {
      msg.textContent = "No encontré partidas en este PDF (busco la tabla Partida, Cantidad, Descripción).";
      return;
    }
    const total = data.items.reduce((t, it) => t + it.quantity, 0);
    const what = `${data.items.length} partida${data.items.length === 1 ? "" : "s"} (${total} prueba${total === 1 ? "" : "s"})`;
    const current = items.get();
    if (current.length && !confirm(`Esta cotización ya tiene ${current.length} partida${current.length === 1 ? "" : "s"}. ¿Las reemplazo por las ${data.items.length} del PDF?`)) {
      msg.textContent = "";
      return;
    }
    const fill = { number: data.number, client: data.client, salesRep: data.preparedBy, notes: data.requester ? `Solicitante: ${data.requester}` : "" };
    if (isNew) {
      for (const [k, v] of Object.entries(fill)) if (v && !$("q_" + k).value.trim()) $("q_" + k).value = v;
      if (data.date) $("n_emision").value = `${data.date}T09:00`;
      await items.save(data.items);
      msg.textContent = `Leí ${what} de ${data.number || "la cotización"}. Revisa los datos y da "Agregar cotización".`;
    } else {
      const body = { items: data.items };
      for (const [k, v] of Object.entries(fill)) if (v && !String(q[k] ?? "").trim()) body[k] = v;
      const res = await mutate(() => api(`/quotes/${q.id}`, { method: "PATCH", body }));
      if (res && $("qiMsg")) $("qiMsg").textContent = `Guardé ${what} del PDF.`;
    }
  });
}
