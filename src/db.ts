import type { ActivityTypeKey, QuoteStatusKey, StageKey } from "./catalog";
import type { ActivityFields, QuoteFields, SampleFields } from "./schemas";

export interface StageEvent {
  id: number;
  stage: StageKey;
  at: string | null;
  note: string;
}

export interface QuoteEvent {
  id: number;
  status: QuoteStatusKey;
  at: string | null;
  note: string;
}

export interface Sample {
  id: string;
  code: string;
  receipt: string;
  quote: string;
  quoteId: string | null;
  client: string;
  test: string;
  standard: string;
  consultant: string;
  salesRep: string;
  adminByMe: boolean;
  testByMe: boolean;
  receivedAt: string | null;
  businessDays: number | null;
  dueOn: string | null;
  conditioningStart: string | null;
  conditioningEnd: string | null;
  stage: StageKey;
  stageSince: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: StageEvent[];
}

export interface Quote {
  id: string;
  number: string;
  client: string;
  salesRep: string;
  tests: string;
  notes: string;
  status: QuoteStatusKey;
  statusSince: string | null;
  poReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: QuoteEvent[];
}

export interface Activity {
  id: string;
  type: ActivityTypeKey;
  startedAt: string;
  endedAt: string | null;
  note: string;
  quoteId: string | null;
  sampleId: string | null;
}

type Row = Record<string, unknown>;

/** Campo de la API → columna, y conversión de booleanos (SQLite guarda 0/1). */
const SAMPLE_COLUMNS: Record<keyof SampleFields, string> = {
  code: "code",
  receipt: "receipt",
  quote: "quote",
  quoteId: "quote_id",
  client: "client",
  test: "test",
  standard: "standard",
  consultant: "consultant",
  salesRep: "sales_rep",
  adminByMe: "admin_by_me",
  testByMe: "test_by_me",
  receivedAt: "received_at",
  businessDays: "business_days",
  dueOn: "due_on",
  conditioningStart: "conditioning_start",
  conditioningEnd: "conditioning_end",
};

const QUOTE_COLUMNS: Record<keyof QuoteFields, string> = {
  number: "number",
  client: "client",
  salesRep: "sales_rep",
  tests: "tests",
  notes: "notes",
  poReceivedAt: "po_received_at",
};

const ACTIVITY_COLUMNS: Record<keyof ActivityFields, string> = {
  type: "type",
  startedAt: "started_at",
  endedAt: "ended_at",
  note: "note",
  quoteId: "quote_id",
  sampleId: "sample_id",
};

const toDb = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

/** Pares columna/valor de los campos presentes (los undefined no se tocan). */
function assignments<T extends object>(fields: T, columns: Record<keyof T, string>) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as [keyof T, unknown][];
  return { cols: entries.map(([k]) => columns[k]), values: entries.map(([, v]) => toDb(v)) };
}

const bumpVersion = (db: D1Database) =>
  db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'board_version'");

const changed = (r: D1Result | undefined) => (r?.meta.changes ?? 0) > 0;

function toSample(r: Row, history: StageEvent[]): Sample {
  return {
    id: r.id as string,
    code: r.code as string,
    receipt: (r.receipt as string) ?? "",
    quote: r.quote as string,
    quoteId: (r.quote_id as string | null) ?? null,
    client: r.client as string,
    test: r.test as string,
    standard: r.standard as string,
    consultant: r.consultant as string,
    salesRep: r.sales_rep as string,
    adminByMe: r.admin_by_me === 1,
    testByMe: r.test_by_me === 1,
    receivedAt: (r.received_at as string | null) ?? null,
    businessDays: (r.business_days as number | null) ?? null,
    dueOn: (r.due_on as string | null) ?? null,
    conditioningStart: (r.conditioning_start as string | null) ?? null,
    conditioningEnd: (r.conditioning_end as string | null) ?? null,
    stage: r.stage as StageKey,
    stageSince: (r.stage_since as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    history,
  };
}

function toQuote(r: Row, history: QuoteEvent[]): Quote {
  return {
    id: r.id as string,
    number: r.number as string,
    client: r.client as string,
    salesRep: r.sales_rep as string,
    tests: r.tests as string,
    notes: r.notes as string,
    status: r.status as QuoteStatusKey,
    statusSince: (r.status_since as string | null) ?? null,
    poReceivedAt: (r.po_received_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    history,
  };
}

function toActivity(r: Row): Activity {
  return {
    id: r.id as string,
    type: r.type as ActivityTypeKey,
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
    note: r.note as string,
    quoteId: (r.quote_id as string | null) ?? null,
    sampleId: (r.sample_id as string | null) ?? null,
  };
}

function groupBy<E>(rows: Row[], key: string, map: (r: Row) => E): Map<string, E[]> {
  const out = new Map<string, E[]>();
  for (const r of rows) {
    const k = r[key] as string;
    const list = out.get(k) ?? [];
    list.push(map(r));
    out.set(k, list);
  }
  return out;
}

const stageEvent = (e: Row): StageEvent => ({ id: e.id as number, stage: e.stage as StageKey, at: e.at as string | null, note: e.note as string });
const quoteEvent = (e: Row): QuoteEvent => ({ id: e.id as number, status: e.status as QuoteStatusKey, at: e.at as string | null, note: e.note as string });

// --- Tablero ------------------------------------------------------------------

export async function boardVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'board_version'").first<{ value: number }>();
  return row?.value ?? 0;
}

/** Todo lo que la página necesita en una sola lectura. Actividades: las de los últimos `activityDays` días. */
export async function loadBoard(db: D1Database, activitySince: string) {
  const [samples, stageEvents, quotes, quoteEvents, activities] = await db.batch([
    db.prepare("SELECT * FROM samples ORDER BY created_at"),
    db.prepare("SELECT id, sample_id, stage, at, note FROM stage_events ORDER BY id"),
    db.prepare("SELECT * FROM quotes ORDER BY created_at"),
    db.prepare("SELECT id, quote_id, status, at, note FROM quote_events ORDER BY id"),
    db.prepare("SELECT * FROM activities WHERE started_at >= ? OR ended_at IS NULL ORDER BY started_at").bind(activitySince),
  ]);
  const se = groupBy(stageEvents!.results as Row[], "sample_id", stageEvent);
  const qe = groupBy(quoteEvents!.results as Row[], "quote_id", quoteEvent);
  return {
    samples: (samples!.results as Row[]).map((r) => toSample(r, se.get(r.id as string) ?? [])),
    quotes: (quotes!.results as Row[]).map((r) => toQuote(r, qe.get(r.id as string) ?? [])),
    activities: (activities!.results as Row[]).map(toActivity),
  };
}

// --- Muestras -----------------------------------------------------------------

export async function listSamples(db: D1Database): Promise<Sample[]> {
  return (await loadBoard(db, "9999")).samples;
}

export async function getSample(db: D1Database, id: string): Promise<Sample | null> {
  const [samples, events] = await db.batch([
    db.prepare("SELECT * FROM samples WHERE id = ?").bind(id),
    db.prepare("SELECT id, sample_id, stage, at, note FROM stage_events WHERE sample_id = ? ORDER BY id").bind(id),
  ]);
  const row = samples!.results[0] as Row | undefined;
  return row ? toSample(row, (events!.results as Row[]).map(stageEvent)) : null;
}

export async function createSample(
  db: D1Database,
  fields: SampleFields,
  stage: StageKey,
  note: string,
  at: string,
  now: string,
): Promise<string> {
  const id = crypto.randomUUID();
  const { cols, values } = assignments(fields, SAMPLE_COLUMNS);
  const extra: Record<string, unknown> = {
    id,
    stage,
    stage_since: at,
    delivered_at: stage === "entregado" ? at : null,
    created_at: now,
    updated_at: now,
  };
  if (stage === "acondicionando" && !fields.conditioningStart) extra.conditioning_start = at;
  const allCols = [...cols, ...Object.keys(extra)];
  await db.batch([
    db
      .prepare(`INSERT INTO samples (${allCols.join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})`)
      .bind(...values, ...Object.values(extra)),
    db
      .prepare("INSERT INTO stage_events (sample_id, stage, at, note, recorded_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, stage, at, note, now),
    bumpVersion(db),
  ]);
  return id;
}

export async function updateSample(db: D1Database, id: string, fields: SampleFields, now: string): Promise<boolean> {
  const { cols, values } = assignments(fields, SAMPLE_COLUMNS);
  const [result] = await db.batch([
    db
      .prepare(`UPDATE samples SET ${[...cols, "updated_at"].map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...values, now, id),
    bumpVersion(db),
  ]);
  return changed(result);
}

/**
 * Registra el paso a otra etapa en el momento `at` (ahora, o una fecha pasada).
 * Al entrar a "Acondicionando" se anota el inicio, y al salir de ahí el fin,
 * salvo que ya estuvieran capturados a mano.
 */
export async function changeStage(
  db: D1Database,
  id: string,
  stage: StageKey,
  note: string,
  at: string,
  now: string,
): Promise<boolean> {
  const [result] = await db.batch([
    db
      .prepare(
        `UPDATE samples SET
           conditioning_start = CASE WHEN ?1 = 'acondicionando' AND conditioning_start IS NULL THEN ?2 ELSE conditioning_start END,
           conditioning_end = CASE WHEN stage = 'acondicionando' AND ?1 <> 'acondicionando' AND conditioning_end IS NULL THEN ?2 ELSE conditioning_end END,
           stage = ?1, stage_since = ?2, delivered_at = CASE WHEN ?1 = 'entregado' THEN ?2 ELSE NULL END, updated_at = ?4
         WHERE id = ?3`,
      )
      .bind(stage, at, id, now),
    db
      .prepare(
        // Solo inserta si la muestra existe, para no dejar eventos huérfanos.
        "INSERT INTO stage_events (sample_id, stage, at, note, recorded_at) SELECT id, ?, ?, ?, ? FROM samples WHERE id = ?",
      )
      .bind(stage, at, note, now, id),
    bumpVersion(db),
  ]);
  return changed(result);
}

export async function deleteSample(db: D1Database, id: string): Promise<boolean> {
  const [, , result] = await db.batch([
    db.prepare("DELETE FROM stage_events WHERE sample_id = ?").bind(id),
    db.prepare("UPDATE activities SET sample_id = NULL WHERE sample_id = ?").bind(id),
    db.prepare("DELETE FROM samples WHERE id = ?").bind(id),
    bumpVersion(db),
  ]);
  return changed(result);
}

// --- Cotizaciones ---------------------------------------------------------------

export async function getQuote(db: D1Database, id: string): Promise<Quote | null> {
  const [quotes, events] = await db.batch([
    db.prepare("SELECT * FROM quotes WHERE id = ?").bind(id),
    db.prepare("SELECT id, quote_id, status, at, note FROM quote_events WHERE quote_id = ? ORDER BY id").bind(id),
  ]);
  const row = quotes!.results[0] as Row | undefined;
  return row ? toQuote(row, (events!.results as Row[]).map(quoteEvent)) : null;
}

export async function createQuote(
  db: D1Database,
  fields: QuoteFields,
  status: QuoteStatusKey,
  note: string,
  at: string,
  now: string,
): Promise<string> {
  const id = crypto.randomUUID();
  if (status === "comprada" && fields.poReceivedAt === undefined) fields = { ...fields, poReceivedAt: at };
  const { cols, values } = assignments(fields, QUOTE_COLUMNS);
  const allCols = [...cols, "id", "status", "status_since", "created_at", "updated_at"];
  await db.batch([
    db
      .prepare(`INSERT INTO quotes (${allCols.join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})`)
      .bind(...values, id, status, at, now, now),
    db
      .prepare("INSERT INTO quote_events (quote_id, status, at, note, recorded_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, status, at, note, now),
    bumpVersion(db),
  ]);
  return id;
}

export async function updateQuote(db: D1Database, id: string, fields: QuoteFields, now: string): Promise<boolean> {
  const { cols, values } = assignments(fields, QUOTE_COLUMNS);
  const [result] = await db.batch([
    db
      .prepare(`UPDATE quotes SET ${[...cols, "updated_at"].map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...values, now, id),
    bumpVersion(db),
  ]);
  return changed(result);
}

export async function changeQuoteStatus(
  db: D1Database,
  id: string,
  status: QuoteStatusKey,
  note: string,
  at: string,
  now: string,
): Promise<boolean> {
  const [result] = await db.batch([
    db
      .prepare(
        // Al comprarse, la llegada de la orden de compra toma esa fecha si no se había capturado.
        `UPDATE quotes SET status = ?1, status_since = ?2, updated_at = ?3,
           po_received_at = CASE WHEN ?1 = 'comprada' AND po_received_at IS NULL THEN ?2 ELSE po_received_at END
         WHERE id = ?4`,
      )
      .bind(status, at, now, id),
    db
      .prepare(
        "INSERT INTO quote_events (quote_id, status, at, note, recorded_at) SELECT id, ?, ?, ?, ? FROM quotes WHERE id = ?",
      )
      .bind(status, at, note, now, id),
    bumpVersion(db),
  ]);
  return changed(result);
}

/** Borra la cotización; sus muestras y actividades se conservan, solo pierden el vínculo. */
export async function deleteQuote(db: D1Database, id: string): Promise<boolean> {
  const [, , , result] = await db.batch([
    db.prepare("DELETE FROM quote_events WHERE quote_id = ?").bind(id),
    db.prepare("UPDATE samples SET quote_id = NULL WHERE quote_id = ?").bind(id),
    db.prepare("UPDATE activities SET quote_id = NULL WHERE quote_id = ?").bind(id),
    db.prepare("DELETE FROM quotes WHERE id = ?").bind(id),
    bumpVersion(db),
  ]);
  return changed(result);
}

// --- Correcciones al historial -----------------------------------------------------

/**
 * Corrige la fecha o la nota de un renglón del historial. Si es el último renglón,
 * "desde cuándo" está en su etapa o estado se mueve con él.
 */
export async function editStageEvent(
  db: D1Database,
  sampleId: string,
  eventId: number,
  edit: { at?: string; note?: string },
  isLast: boolean,
  stage: StageKey,
  now: string,
): Promise<boolean> {
  const stmts = [
    db
      .prepare("UPDATE stage_events SET at = COALESCE(?, at), note = COALESCE(?, note) WHERE id = ? AND sample_id = ?")
      .bind(edit.at ?? null, edit.note ?? null, eventId, sampleId),
  ];
  if (isLast && edit.at) {
    stmts.push(
      db
        .prepare("UPDATE samples SET stage_since = ?1, delivered_at = CASE WHEN ?2 = 'entregado' THEN ?1 ELSE delivered_at END, updated_at = ?3 WHERE id = ?4")
        .bind(edit.at, stage, now, sampleId),
    );
  }
  const [result] = await db.batch([...stmts, bumpVersion(db)]);
  return changed(result);
}

export async function editQuoteEvent(
  db: D1Database,
  quoteId: string,
  eventId: number,
  edit: { at?: string; note?: string },
  isLast: boolean,
  now: string,
): Promise<boolean> {
  const stmts = [
    db
      .prepare("UPDATE quote_events SET at = COALESCE(?, at), note = COALESCE(?, note) WHERE id = ? AND quote_id = ?")
      .bind(edit.at ?? null, edit.note ?? null, eventId, quoteId),
  ];
  if (isLast && edit.at) {
    stmts.push(db.prepare("UPDATE quotes SET status_since = ?, updated_at = ? WHERE id = ?").bind(edit.at, now, quoteId));
  }
  const [result] = await db.batch([...stmts, bumpVersion(db)]);
  return changed(result);
}

// --- Actividades (registro de tiempo) -------------------------------------------

export async function getActivity(db: D1Database, id: string): Promise<Activity | null> {
  const row = await db.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first<Row>();
  return row ? toActivity(row) : null;
}

/** Crea un bloque de tiempo. Si queda en curso, cierra el que estuviera corriendo. */
export async function createActivity(db: D1Database, fields: ActivityFields, now: string): Promise<string> {
  const id = crypto.randomUUID();
  const startedAt = fields.startedAt ?? now;
  const running = !fields.endedAt;
  const { cols, values } = assignments({ ...fields, startedAt }, ACTIVITY_COLUMNS);
  const allCols = [...cols, "id", "created_at", "updated_at"];
  await db.batch([
    ...(running
      ? [db.prepare("UPDATE activities SET ended_at = ?, updated_at = ? WHERE ended_at IS NULL").bind(now, now)]
      : []),
    db
      .prepare(`INSERT INTO activities (${allCols.join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})`)
      .bind(...values, id, now, now),
    bumpVersion(db),
  ]);
  return id;
}

export async function updateActivity(db: D1Database, id: string, fields: ActivityFields, now: string): Promise<boolean> {
  const { cols, values } = assignments(fields, ACTIVITY_COLUMNS);
  const [result] = await db.batch([
    db
      .prepare(`UPDATE activities SET ${[...cols, "updated_at"].map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...values, now, id),
    bumpVersion(db),
  ]);
  return changed(result);
}

export async function deleteActivity(db: D1Database, id: string): Promise<boolean> {
  const [result] = await db.batch([db.prepare("DELETE FROM activities WHERE id = ?").bind(id), bumpVersion(db)]);
  return changed(result);
}

// --- Inicio de sesión -------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 10;

export async function recentLoginFailures(db: D1Database, ip: string, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, now - LOGIN_WINDOW_MS)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordLoginFailure(db: D1Database, ip: string, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM login_failures WHERE at <= ?").bind(now - LOGIN_WINDOW_MS),
    db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now),
  ]);
}
