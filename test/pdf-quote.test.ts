import { describe, expect, it } from "vitest";
import { parseQuote } from "../public/js/pdf-quote.js";

/** Renglones como los entrega pdf.js: texto con su posición (y crece hacia arriba). */
const at = (x: number, y: number, str: string) => ({ str, x, y });

// Cotización ficticia con el formato del laboratorio (sin datos de clientes reales).
const page1 = [
  at(444, 778, "Referencia:"), at(525, 777.6, "C26"), at(553, 777.6, "123"),
  at(462, 764.5, "Fecha :"), at(536, 764.8, "2026/9/3"),
  at(53, 730, "Elabora:"), at(90, 731, "Persona Que Cotiza"),
  at(49, 694, "Empresa:"), at(93, 695, "Empresa Ficticia"),
  at(42, 678, "Solicitante:"), at(93, 678.6, "Contacto Ficticio"), at(309, 678, "Departamento:"),
  at(30, 626, "Partida"), at(87, 626, "Cantidad"), at(143, 626, "Descripción"), at(419, 626, "P.Unitario"), at(480, 626, "Importe"),
  at(58, 595, "1"), at(87, 595, "3.00"), at(144, 595, "Flamabilidad horizontal (*) según"), at(439, 595, "1,000.00"),
  at(144, 583, "ISO 3795"),
  at(58, 520, "2"), at(87, 520, "1.00"), at(144, 520, "Índice de fluidez"), at(439, 520, "900.00"),
  at(27, 155, "Observaciones :"), at(18, 121, "Texto de observaciones 1 que no es partida"),
];

describe("importar cotización en PDF", () => {
  it("lee número, fecha, empresa, quién la elaboró y las partidas con su cantidad", () => {
    const q = parseQuote([page1, [at(30, 600, "Página 2 sin partidas")]]);
    expect(q).toEqual({
      number: "C26.123",
      date: "2026-09-03",
      client: "Empresa Ficticia",
      preparedBy: "Persona Que Cotiza",
      requester: "Contacto Ficticio",
      items: [
        { test: "Flamabilidad horizontal según ISO 3795", quantity: 3 },
        { test: "Índice de fluidez", quantity: 1 },
      ],
    });
  });

  it("sin tabla de partidas no inventa nada", () => {
    expect(parseQuote([[at(10, 10, "Otro documento")]]).items).toEqual([]);
  });
});
