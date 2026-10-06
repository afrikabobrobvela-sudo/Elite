/**
 * Catálogos del laboratorio. La página los recibe de GET /api/v1/catalog,
 * así que cambiar algo aquí basta para que aparezca en todos lados.
 */

/**
 * Etapas de una muestra, en orden. `phase` separa la parte administrativa
 * (antes de entregar probetas al consultor) de la evaluación.
 * `owner` dice de quién depende avanzar: "admin" o "tester" son de Rodrigo
 * si la muestra tiene marcada esa parte como suya; el resto es espera de otros.
 * `activity` es el tipo de actividad que se cronometra al trabajar en esa etapa.
 */
export const STAGES = [
  { key: "recibo_muestra", name: "Recibo de muestra", phase: "admin", owner: "admin", who: "Recibir material y hacer el recibo", activity: "recibo" },
  { key: "vobo", name: "En VoBo", phase: "admin", owner: "cliente", who: "Espera el VoBo del cliente", activity: "maquinado" },
  { key: "maquinado", name: "En maquinado", phase: "admin", owner: "taller", who: "Taller", activity: "maquinado" },
  { key: "probetas", name: "Probetas listas", phase: "admin", owner: "admin", who: "Recoger y entregar a consultor" },
  { key: "recibido", name: "Recibido por consultor", phase: "eval", owner: "tester", who: "Por iniciar acondicionamiento", activity: "prueba" },
  { key: "acondicionando", name: "Acondicionando", phase: "eval", owner: "espera", who: "Tiempo de norma" },
  { key: "prueba", name: "En prueba", phase: "eval", owner: "tester", who: "Consultor", activity: "prueba" },
  { key: "reporte", name: "Elaborando reporte", phase: "eval", owner: "tester", who: "Consultor", activity: "reporte" },
  { key: "revision", name: "En revisión", phase: "eval", owner: "par", who: "Revisión de par", activity: "revision" },
  { key: "entregado", name: "Entregado", phase: "eval", owner: "nadie", who: "Liberado en Drive" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export const STAGE_KEYS = STAGES.map((s) => s.key) as [StageKey, ...StageKey[]];

/** Estados de una cotización (módulo administrativo). */
export const QUOTE_STATUSES = [
  { key: "elaboracion", name: "En elaboración", who: "Cotizar y revisar norma" },
  { key: "enviada", name: "Enviada al cliente", who: "Espera respuesta" },
  { key: "seguimiento", name: "En seguimiento", who: "Dar seguimiento" },
  { key: "comprada", name: "Comprada", who: "Pasa a muestras" },
  { key: "perdida", name: "No se concretó", who: "Cerrada" },
] as const;

export type QuoteStatusKey = (typeof QUOTE_STATUSES)[number]["key"];
export const QUOTE_STATUS_KEYS = QUOTE_STATUSES.map((s) => s.key) as [QuoteStatusKey, ...QuoteStatusKey[]];

/** Pruebas que hace el laboratorio. Flexión, tensión e impacto van por separado. */
export const TESTS = [
  "Flamabilidad Horizontal",
  "FTIR",
  "Color y Brillo",
  "VICAT",
  "Prueba de Flexión",
  "Prueba de Tensión",
  "Prueba de Impacto",
  "Caída de Bola",
  "Comportamiento a Alta Temperatura",
  "Comportamiento a Baja Temperatura",
  "PV1200",
  "Densidad",
  "Cenizas",
  "Formaldehídos",
  "Olor",
  "Fogging",
  "Índice de Fluidez",
] as const;

/** Una cotización enviada que no se ha comprado pide seguimiento cada tantos días naturales. */
export const FOLLOW_UP_DAYS = 15;

/** Para flamabilidad el acondicionamiento dura de 1 a 7 días naturales. */
export const CONDITIONING_LIMITS: Record<string, { minDays: number; maxDays: number }> = {
  "Flamabilidad Horizontal": { minDays: 1, maxDays: 7 },
};

/** Tipos de actividad para el registro de tiempo, agrupados en administrativo / evaluación / otro. */
export const ACTIVITY_TYPES = [
  { key: "cotizacion", name: "Elaborar cotización", group: "admin" },
  { key: "norma", name: "Revisar norma y alcance", group: "admin" },
  { key: "seguimiento", name: "Seguimiento a cotizaciones y solicitudes", group: "admin" },
  { key: "clientes", name: "Atención a clientes", group: "admin" },
  { key: "recibo", name: "Recibo de muestra", group: "admin" },
  { key: "maquinado", name: "VoBo y orden de maquinado", group: "admin" },
  { key: "prueba", name: "Pruebas de laboratorio", group: "eval" },
  { key: "reporte", name: "Elaboración de reporte", group: "eval" },
  { key: "revision", name: "Revisión de reportes de par", group: "eval" },
  { key: "otra", name: "Otra actividad", group: "otro" },
] as const;

export type ActivityTypeKey = (typeof ACTIVITY_TYPES)[number]["key"];
export const ACTIVITY_TYPE_KEYS = ACTIVITY_TYPES.map((a) => a.key) as [ActivityTypeKey, ...ActivityTypeKey[]];

export const ACTIVITY_GROUPS = [
  { key: "admin", name: "Administrativo" },
  { key: "eval", name: "Evaluación de muestras" },
  { key: "otro", name: "Otro" },
] as const;
