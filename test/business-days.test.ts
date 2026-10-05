import { describe, expect, it } from "vitest";
import { addBusinessDays, businessDaysBetween, dueStatus, holidays } from "../public/business-days.js";

describe("días hábiles", () => {
  it("salta fines de semana como WORKDAY de Excel", () => {
    // Lunes 14 sep 2026 + 7 hábiles; el 16 de septiembre es feriado.
    expect(addBusinessDays("2026-09-14", 7)).toBe("2026-09-24");
    expect(addBusinessDays("2026-10-02", 1)).toBe("2026-10-05"); // viernes → lunes
  });

  it("conoce los feriados de ley de 2026", () => {
    expect([...holidays(2026)]).toEqual([
      "2026-01-01",
      "2026-02-02",
      "2026-03-16",
      "2026-05-01",
      "2026-09-16",
      "2026-11-16",
      "2026-12-25",
    ]);
    expect(holidays(2030).has("2030-10-01")).toBe(true);
  });

  it("cuenta días hábiles con signo", () => {
    expect(businessDaysBetween(new Date(2026, 9, 5), new Date(2026, 9, 9))).toBe(4);
    expect(businessDaysBetween(new Date(2026, 9, 9), new Date(2026, 9, 5))).toBe(-4);
    expect(businessDaysBetween(new Date(2026, 9, 5), new Date(2026, 9, 5))).toBe(0);
  });
});

describe("semáforo de fecha compromiso", () => {
  const now = new Date(2026, 9, 5, 10); // lunes 5 oct 2026
  it("verde con margen, ámbar a 2 días, rojo vencida", () => {
    expect(dueStatus({ stage: "prueba", dueOn: "2026-10-12" }, now).c).toBe("ok");
    expect(dueStatus({ stage: "prueba", dueOn: "2026-10-07" }, now)).toEqual({ c: "warn", t: "Vence en 2 d" });
    expect(dueStatus({ stage: "prueba", dueOn: "2026-10-05" }, now)).toEqual({ c: "warn", t: "Vence hoy" });
    expect(dueStatus({ stage: "prueba", dueOn: "2026-10-01" }, now)).toEqual({ c: "late", t: "Vencida 2 d" });
    expect(dueStatus({ stage: "prueba", dueOn: null }, now).c).toBe("");
  });
  it("entregadas: a tiempo o tarde", () => {
    const base = { stage: "entregado", dueOn: "2026-10-01" };
    expect(dueStatus({ ...base, deliveredAt: "2026-10-01T22:00:00" }, now).c).toBe("done");
    expect(dueStatus({ ...base, deliveredAt: "2026-10-02T09:00:00" }, now).c).toBe("late");
  });
});
