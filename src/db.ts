import type { SampleFields } from "./schemas";
import type { StageKey } from "./stages";

export interface StageEvent {
  stage: StageKey;
  at: string | null;
  note: string;
}

export interface Sample {
  id: string;
  code: string;
  quote: string;
  client: string;
  test: string;
  standard: string;
  consultant: string;
  salesRep: string;
  receivedOn: string | null;
  businessDays: number | null;
  dueOn: string | null;
  stage: StageKey;
  stageSince: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: StageEvent[];
}

interface SampleRow {
  id: string;
  code: string;
  quote: string;
  client: string;
  test: string;
  standard: string;
  consultant: string;
  sales_rep: string;
  received_on: string | null;
  business_days: number | null;
  due_on: string | null;
  stage: StageKey;
  stage_since: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  sample_id: string;
  stage: StageKey;
  at: string | null;
  note: string;
}

/** Columna de la tabla para cada campo editable de la API. */
const COLUMNS: Record<keyof SampleFields, string> = {
  code: "code",
  quote: "quote",
  client: "client",
  test: "test",
  standard: "standard",
  consultant: "consultant",
  salesRep: "sales_rep",
  receivedOn: "received_on",
  businessDays: "business_days",
  dueOn: "due_on",
};

const bumpVersion = (db: D1Database) =>
  db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'board_version'");

function toSample(row: SampleRow, history: StageEvent[]): Sample {
  return {
    id: row.id,
    code: row.code,
    quote: row.quote,
    client: row.client,
    test: row.test,
    standard: row.standard,
    consultant: row.consultant,
    salesRep: row.sales_rep,
    receivedOn: row.received_on,
    businessDays: row.business_days,
    dueOn: row.due_on,
    stage: row.stage,
    stageSince: row.stage_since,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history,
  };
}

export async function boardVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'board_version'").first<{ value: number }>();
  return row?.value ?? 0;
}

export async function listSamples(db: D1Database): Promise<Sample[]> {
  const [samples, events] = await db.batch([
    db.prepare("SELECT * FROM samples ORDER BY created_at"),
    db.prepare("SELECT sample_id, stage, at, note FROM stage_events ORDER BY id"),
  ]);
  const bySample = new Map<string, StageEvent[]>();
  for (const e of events!.results as EventRow[]) {
    const list = bySample.get(e.sample_id) ?? [];
    list.push({ stage: e.stage, at: e.at, note: e.note });
    bySample.set(e.sample_id, list);
  }
  return (samples!.results as SampleRow[]).map((r) => toSample(r, bySample.get(r.id) ?? []));
}

export async function getSample(db: D1Database, id: string): Promise<Sample | null> {
  const [samples, events] = await db.batch([
    db.prepare("SELECT * FROM samples WHERE id = ?").bind(id),
    db.prepare("SELECT sample_id, stage, at, note FROM stage_events WHERE sample_id = ? ORDER BY id").bind(id),
  ]);
  const row = samples!.results[0] as SampleRow | undefined;
  if (!row) return null;
  return toSample(
    row,
    (events!.results as EventRow[]).map((e) => ({ stage: e.stage, at: e.at, note: e.note })),
  );
}

export async function createSample(
  db: D1Database,
  fields: SampleFields,
  stage: StageKey,
  note: string,
  now: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO samples (id, code, quote, client, test, standard, consultant, sales_rep,
           received_on, business_days, due_on, stage, stage_since, delivered_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        fields.code ?? "",
        fields.quote ?? "",
        fields.client ?? "",
        fields.test ?? "",
        fields.standard ?? "",
        fields.consultant ?? "",
        fields.salesRep ?? "",
        fields.receivedOn ?? null,
        fields.businessDays ?? null,
        fields.dueOn ?? null,
        stage,
        now,
        stage === "entregado" ? now : null,
        now,
        now,
      ),
    db
      .prepare("INSERT INTO stage_events (sample_id, stage, at, note, recorded_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, stage, now, note, now),
    bumpVersion(db),
  ]);
  return id;
}

export async function updateSample(db: D1Database, id: string, fields: SampleFields, now: string): Promise<boolean> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as [keyof SampleFields, unknown][];
  const sets = entries.map(([k]) => `${COLUMNS[k]} = ?`);
  const values = entries.map(([, v]) => v);
  const [result] = await db.batch([
    db.prepare(`UPDATE samples SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`).bind(...values, now, id),
    bumpVersion(db),
  ]);
  return (result!.meta.changes ?? 0) > 0;
}

/** Registra el paso a otra etapa con la hora del servidor. */
export async function changeStage(
  db: D1Database,
  id: string,
  stage: StageKey,
  note: string,
  now: string,
): Promise<boolean> {
  const [result] = await db.batch([
    db
      .prepare(
        "UPDATE samples SET stage = ?, stage_since = ?, delivered_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(stage, now, stage === "entregado" ? now : null, now, id),
    db
      .prepare(
        // Solo inserta si la muestra existe, para no dejar eventos huérfanos.
        "INSERT INTO stage_events (sample_id, stage, at, note, recorded_at) SELECT id, ?, ?, ?, ? FROM samples WHERE id = ?",
      )
      .bind(stage, now, note, now, id),
    bumpVersion(db),
  ]);
  return (result!.meta.changes ?? 0) > 0;
}

export async function deleteSample(db: D1Database, id: string): Promise<boolean> {
  const [, result] = await db.batch([
    db.prepare("DELETE FROM stage_events WHERE sample_id = ?").bind(id),
    db.prepare("DELETE FROM samples WHERE id = ?").bind(id),
    bumpVersion(db),
  ]);
  return (result!.meta.changes ?? 0) > 0;
}

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
