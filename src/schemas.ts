import { z } from "zod";
import { ACTIVITY_TYPE_KEYS, QUOTE_STATUS_KEYS, STAGE_KEYS } from "./catalog";

const text = (max: number) => z.string().trim().max(max);

const isoDay = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}, "Fecha inválida: usa el formato AAAA-MM-DD");

/** Fecha y hora ISO 8601 con zona (la página manda toISOString()). */
const isoDateTime = z.iso.datetime({ offset: true, message: "Fecha y hora inválidas" });

/** La lista del catálogo es una sugerencia: también se aceptan pruebas escritas a mano. */
const testName = text(200);

/** Campos editables de una muestra. */
export const sampleFields = z.object({
  code: text(40).optional(),
  quote: text(40).optional(),
  quoteId: z.string().max(64).nullable().optional(),
  client: text(200).optional(),
  test: testName.optional(),
  standard: text(200).optional(),
  consultant: text(100).optional(),
  salesRep: text(100).optional(),
  adminByMe: z.boolean().optional(),
  testByMe: z.boolean().optional(),
  receivedAt: isoDateTime.nullable().optional(),
  businessDays: z.number().int().min(0).max(365).nullable().optional(),
  dueOn: isoDay.nullable().optional(),
  conditioningStart: isoDateTime.nullable().optional(),
  conditioningEnd: isoDateTime.nullable().optional(),
});

/** `at`: cuándo ocurrió de verdad (para registrar cosas pasadas); si falta, es ahora. */
export const createSample = sampleFields.extend({
  stage: z.enum(STAGE_KEYS).default("recibo_muestra"),
  note: text(500).optional(),
  at: isoDateTime.optional(),
});

export const updateSample = sampleFields.refine((v) => Object.keys(v).length > 0, {
  message: "No hay campos para actualizar",
});

export const stageChange = z.object({
  stage: z.enum(STAGE_KEYS),
  note: text(500).optional(),
  at: isoDateTime.optional(),
});

/** Corrección de un renglón del historial (de muestra o de cotización). */
export const eventEdit = z
  .object({ at: isoDateTime.optional(), note: text(500).optional() })
  .refine((v) => v.at !== undefined || v.note !== undefined, { message: "No hay campos para actualizar" });

/** Campos editables de una cotización. */
export const quoteFields = z.object({
  number: text(40).optional(),
  client: text(200).optional(),
  salesRep: text(100).optional(),
  tests: text(500).optional(),
  notes: text(1000).optional(),
  poReceivedAt: isoDateTime.nullable().optional(),
});

export const createQuote = quoteFields.extend({
  status: z.enum(QUOTE_STATUS_KEYS).default("elaboracion"),
  note: text(500).optional(),
  at: isoDateTime.optional(),
});

export const updateQuote = quoteFields.refine((v) => Object.keys(v).length > 0, {
  message: "No hay campos para actualizar",
});

export const quoteStatusChange = z.object({
  status: z.enum(QUOTE_STATUS_KEYS),
  note: text(500).optional(),
  at: isoDateTime.optional(),
});

/** Bloque de tiempo. Sin endedAt queda "en curso" (y detiene el que estuviera corriendo). */
export const activityFields = z.object({
  type: z.enum(ACTIVITY_TYPE_KEYS).optional(),
  startedAt: isoDateTime.optional(),
  endedAt: isoDateTime.nullable().optional(),
  note: text(500).optional(),
  quoteId: z.string().max(64).nullable().optional(),
  sampleId: z.string().max(64).nullable().optional(),
});

export const createActivity = activityFields.extend({ type: z.enum(ACTIVITY_TYPE_KEYS) });

export const updateActivity = activityFields.refine((v) => Object.keys(v).length > 0, {
  message: "No hay campos para actualizar",
});

export const login = z.object({ password: z.string().min(1).max(200) });

export type SampleFields = z.infer<typeof sampleFields>;
export type QuoteFields = z.infer<typeof quoteFields>;
export type ActivityFields = z.infer<typeof activityFields>;
