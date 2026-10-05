import { z } from "zod";
import { STAGE_KEYS } from "./stages";

const text = (max: number) => z.string().trim().max(max);
const isoDay = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}, "Fecha inválida: usa el formato AAAA-MM-DD");

/** Campos editables de una muestra (todo opcional salvo en creación, donde se aplica default). */
export const sampleFields = z.object({
  code: text(40).optional(),
  quote: text(40).optional(),
  client: text(200).optional(),
  test: text(100).optional(),
  standard: text(200).optional(),
  consultant: text(100).optional(),
  salesRep: text(100).optional(),
  receivedOn: isoDay.nullable().optional(),
  businessDays: z.number().int().min(0).max(365).nullable().optional(),
  dueOn: isoDay.nullable().optional(),
});

export const createSample = sampleFields.extend({
  stage: z.enum(STAGE_KEYS).default("recibido"),
  note: text(500).optional(),
});

export const updateSample = sampleFields.refine((v) => Object.keys(v).length > 0, {
  message: "No hay campos para actualizar",
});

export const stageChange = z.object({
  stage: z.enum(STAGE_KEYS),
  note: text(500).optional(),
});

export const login = z.object({ password: z.string().min(1).max(200) });

export type SampleFields = z.infer<typeof sampleFields>;
