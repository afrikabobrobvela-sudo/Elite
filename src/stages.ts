/** Etapas por las que pasa una muestra, en orden. */
export const STAGES = [
  { key: "recibido", name: "Recibido", owner: "Recibo al cliente" },
  { key: "vobo", name: "En VoBo", owner: "Espera al cliente" },
  { key: "maquinado", name: "En maquinado", owner: "Taller" },
  { key: "probetas", name: "Probetas listas", owner: "Por asignar" },
  { key: "acondicionando", name: "Acondicionando", owner: "Tiempo de norma" },
  { key: "prueba", name: "En prueba", owner: "Consultor" },
  { key: "reporte", name: "Elaborando reporte", owner: "Consultor" },
  { key: "revision", name: "En revisión", owner: "Revisión de par" },
  { key: "entregado", name: "Entregado", owner: "Liberado en Drive" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export const STAGE_KEYS = STAGES.map((s) => s.key) as [StageKey, ...StageKey[]];
