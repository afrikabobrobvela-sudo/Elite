// Importar una cotización en PDF: número, fecha, empresa, quién la elaboró y sus partidas.
// El PDF se lee en el navegador con pdf.js (build "legacy" en /vendor/pdfjs, para navegadores no tan
// recientes); el archivo no se sube a ningún lado.

const PDFJS = "/vendor/pdfjs/";
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const clean = (s) => s.replace(/\(\*{1,3}\)|\(#\)/g, " ").replace(/\s+/g, " ").trim();

/** Texto a la derecha de una etiqueta, en el mismo renglón. */
function valueAfter(items, label) {
  const tag = items.find((i) => i.str.replace(/\s+/g, " ").trim().startsWith(label));
  if (!tag) return "";
  const own = tag.str.trim().slice(label.length).replace(/^\s*:/, "").trim();
  const rest = items
    .filter((i) => i !== tag && near(i.y, tag.y) && i.x > tag.x)
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str.trim())
    .filter(Boolean);
  // Solo lo que sigue pegado a la etiqueta (no el siguiente campo del renglón).
  const next = rest.findIndex((s) => /:$/.test(s));
  return clean([own, ...(next === -1 ? rest : rest.slice(0, next))].join(" "));
}

/** Partidas de una página: renglones entre el encabezado (Partida, Cantidad, Descripción) y "Observaciones". */
function pageItems(items) {
  const head = (name) => items.find((i) => i.str.trim() === name);
  const partida = head("Partida"), cantidad = head("Cantidad"), desc = head("Descripción");
  if (!partida || !cantidad || !desc) return [];
  const price = head("P.Unitario") ?? head("P. Unitario") ?? head("Importe");
  const descEnd = price ? price.x - 5 : Infinity;
  const stop = items.filter((i) => i.y < partida.y && /^(Observaciones|Importe con letra|Página)/.test(i.str.trim())).sort((a, b) => b.y - a.y)[0];
  const rows = items.filter((i) => i.y < partida.y - 2 && (!stop || i.y > stop.y + 2) && i.str.trim());
  const anchors = rows
    .filter((i) => i.x < cantidad.x - 5 && /^\d+$/.test(i.str.trim()))
    .sort((a, b) => b.y - a.y);
  return anchors.map((a, k) => {
    const below = anchors[k + 1]?.y ?? -Infinity;
    const qty = rows.find((i) => near(i.y, a.y) && i.x >= cantidad.x - 10 && i.x < desc.x - 5 && /^[\d,]+(\.\d+)?$/.test(i.str.trim()));
    const text = rows
      .filter((i) => i.x >= desc.x - 5 && i.x < descEnd && i.y <= a.y + 2 && i.y > below + 2)
      .sort((x, y) => y.y - x.y || x.x - y.x)
      .map((i) => i.str)
      .join(" ");
    const n = qty ? Number(qty.str.replace(/,/g, "")) : 1;
    return { test: clean(text).slice(0, 200), quantity: Math.max(1, Math.round(n) || 1) };
  }).filter((it) => it.test);
}

/**
 * Datos de la cotización a partir del texto de cada página (pdf.js: str, x, y).
 * Fecha "2026/8/25" → "2026-08-25"; referencia "C26 594" → "C26.594".
 */
export function parseQuote(pages) {
  const first = pages[0] ?? [];
  const ref = valueAfter(first, "Referencia");
  const date = valueAfter(first, "Fecha").match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return {
    number: ref.replace(/\s+/g, "."),
    date: date ? `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}` : "",
    client: valueAfter(first, "Empresa"),
    preparedBy: valueAfter(first, "Elabora"),
    requester: valueAfter(first, "Solicitante"),
    items: pages.flatMap(pageItems),
  };
}

/** Lee el PDF (un File) y devuelve parseQuote de su texto. */
export async function readQuotePdf(file) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS + "pdf.min.mjs"); // solo se descarga al importar
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.filter((i) => i.str !== undefined).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
  }
  await task.destroy();
  return parseQuote(pages);
}
