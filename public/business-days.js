// Días hábiles: lunes a viernes, sin los días de descanso obligatorio de la Ley Federal del Trabajo (México).
// Las fechas "de calendario" (AAAA-MM-DD) se manejan como fechas locales sin hora.

const pad = (n) => String(n).padStart(2, "0");

/** Date local → "AAAA-MM-DD". */
export function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "AAAA-MM-DD" → Date local a medianoche (o null). */
export function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function nthMonday(year, month, n) {
  const d = new Date(year, month, 1);
  const offset = (8 - d.getDay()) % 7; // días hasta el primer lunes
  return 1 + offset + 7 * (n - 1);
}

/** Días de descanso obligatorio (art. 74 LFT) del año dado, como "AAAA-MM-DD". */
export function holidays(year) {
  const list = [
    `${year}-01-01`,
    `${year}-02-${pad(nthMonday(year, 1, 1))}`, // primer lunes de febrero
    `${year}-03-${pad(nthMonday(year, 2, 3))}`, // tercer lunes de marzo
    `${year}-05-01`,
    `${year}-09-16`,
    `${year}-11-${pad(nthMonday(year, 10, 3))}`, // tercer lunes de noviembre
    `${year}-12-25`,
  ];
  if (year >= 2024 && (year - 2024) % 6 === 0) list.push(`${year}-10-01`); // transmisión del Poder Ejecutivo
  return new Set(list);
}

const cache = new Map();
export function isBusinessDay(d) {
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  const y = d.getFullYear();
  if (!cache.has(y)) cache.set(y, holidays(y));
  return !cache.get(y).has(isoDay(d));
}

const startOfDay = (x) => {
  const d = new Date(x);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Días hábiles de a hasta b (sin contar a, contando b). Negativo si b es anterior a a. */
export function businessDaysBetween(a, b) {
  let from = startOfDay(a);
  let to = startOfDay(b);
  let sign = 1;
  if (to < from) {
    [from, to] = [to, from];
    sign = -1;
  }
  let n = 0;
  const d = new Date(from);
  while (d < to) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) n++;
  }
  return n * sign;
}

/** Suma n días hábiles a una fecha "AAAA-MM-DD" (como WORKDAY de Excel). */
export function addBusinessDays(day, n) {
  const d = parseDay(day);
  if (!d) return "";
  let k = 0;
  while (k < n) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) k++;
  }
  return isoDay(d);
}

/**
 * Semáforo de una muestra respecto a su fecha compromiso.
 * c: "ok" | "warn" (vence en ≤2 días hábiles) | "late" | "done" | "" (sin fecha)
 */
export function dueStatus(sample, now = new Date()) {
  const due = parseDay(sample.dueOn);
  if (sample.stage === "entregado") {
    if (!due || !sample.deliveredAt) return { c: "done", t: "Entregado" };
    return startOfDay(sample.deliveredAt) > due ? { c: "late", t: "Entregado tarde" } : { c: "done", t: "A tiempo" };
  }
  if (!due) return { c: "", t: "Sin fecha" };
  const left = businessDaysBetween(now, due);
  if (startOfDay(now) > due) return { c: "late", t: `Vencida ${Math.abs(left)} d` };
  if (left <= 2) return { c: "warn", t: left === 0 ? "Vence hoy" : `Vence en ${left} d` };
  return { c: "ok", t: `Faltan ${left} d` };
}
