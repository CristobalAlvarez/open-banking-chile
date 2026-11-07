import { describe, expect, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  parseCreditCardInfo,
  parseCurrentMonthMovements,
  parseHistoricalMovements,
  parseTcMovements,
} from "./parse.js";

describe("parseCurrentMonthMovements", () => {
  it("marca los cargos como negativos y los abonos como positivos", () => {
    const movements = parseCurrentMonthMovements([
      {
        date: "15/01/2026",
        category: "cargo",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: "$15.990",
      },
      {
        date: "16/01/2026",
        category: "abono",
        description: "TRANSFERENCIA RECIBIDA EJEMPLO",
        amount: "$500.000",
      },
    ]);

    expect(movements).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA EJEMPLO",
        amount: 500000,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("descarta filas sin monto", () => {
    const movements = parseCurrentMonthMovements([
      { date: "17/01/2026", category: "cargo", description: "SIN MONTO", amount: "" },
      { date: "18/01/2026", category: "cargo", description: "MONTO CERO", amount: "$0" },
    ]);

    expect(movements).toEqual([]);
  });
});

describe("parseHistoricalMovements", () => {
  it("convierte los cargos de la cartola histórica en montos negativos", () => {
    const movements = parseHistoricalMovements([
      {
        date: "10/02/2026",
        category: "cargo",
        description: "PAGO TARJETA EJEMPLO",
        amount: "$1.000",
      },
      {
        date: "11/02/2026",
        category: "abono",
        description: "ABONO EJEMPLO",
        amount: "$2.000",
      },
    ]);

    expect(movements.map((m) => [m.date, m.description, m.amount])).toEqual([
      ["10-02-2026", "PAGO TARJETA EJEMPLO", -1000],
      ["11-02-2026", "ABONO EJEMPLO", 2000],
    ]);
  });

  it("descarta montos en cero", () => {
    expect(
      parseHistoricalMovements([
        { date: "12/02/2026", category: "cargo", description: "COMISION", amount: "$0" },
      ])
    ).toEqual([]);
  });
});

describe("parseTcMovements", () => {
  it("trata los gastos como cargos y los abonos/pagos como créditos", () => {
    const movements = parseTcMovements(
      [
        {
          date: "10 ene 2026",
          description: "COMPRA EJEMPLO",
          amount: "$120.000",
          installments: "",
        },
        { date: "11 ene 2026", description: "PAGO TARJETA", amount: "$50.000", installments: "" },
        { date: "12 ene 2026", description: "ABONO SUCURSAL", amount: "$10.000", installments: "" },
        {
          date: "13 ene 2026",
          description: "NOTA DE CRÉDITO",
          amount: "$5.000",
          installments: "",
        },
        { date: "14 ene 2026", description: "REVERSO", amount: "$1.000", installments: "" },
        { date: "15 ene 2026", description: "ANULACIÓN", amount: "$2.000", installments: "" },
      ],
      MOVEMENT_SOURCE.credit_card_unbilled
    );

    expect(movements.map((m) => [m.description, m.amount, m.source])).toEqual([
      ["COMPRA EJEMPLO", -120000, MOVEMENT_SOURCE.credit_card_unbilled],
      ["PAGO TARJETA", 50000, MOVEMENT_SOURCE.credit_card_unbilled],
      ["ABONO SUCURSAL", 10000, MOVEMENT_SOURCE.credit_card_unbilled],
      ["NOTA DE CRÉDITO", 5000, MOVEMENT_SOURCE.credit_card_unbilled],
      ["REVERSO", 1000, MOVEMENT_SOURCE.credit_card_unbilled],
      ["ANULACIÓN", 2000, MOVEMENT_SOURCE.credit_card_unbilled],
    ]);
  });

  it("omite las cuotas '1 de 1' y normaliza las demás a NN/NN", () => {
    const movements = parseTcMovements(
      [
        {
          date: "10 ene 2026",
          description: "SIN CUOTAS",
          amount: "$1.000",
          installments: "1 de 1",
        },
        {
          date: "11 ene 2026",
          description: "EN CUOTAS",
          amount: "$2.000",
          installments: "3 de 12",
        },
      ],
      MOVEMENT_SOURCE.credit_card_billed
    );

    expect(movements[0].installments).toBeUndefined();
    expect(movements[1].installments).toBe("03/12");
  });

  it("descarta filas sin monto", () => {
    expect(
      parseTcMovements(
        [{ date: "10 ene 2026", description: "SIN MONTO", amount: "", installments: "" }],
        MOVEMENT_SOURCE.credit_card_billed
      )
    ).toEqual([]);
  });
});

describe("parseCreditCardInfo", () => {
  it("arma etiqueta, cupos nacionales e internacionales y fechas", () => {
    const info = parseCreditCardInfo({
      label: "Visa****1234",
      nationalUsed: 250000,
      nationalAvailable: 750000,
      nationalTotal: 1000000,
      internationalUsed: 100,
      internationalAvailable: 900,
      internationalTotal: 1000,
      billingPeriod: "05 feb 2026",
      nextBillingDate: "20 feb 2026",
    });

    expect(info).toEqual({
      label: "Visa****1234",
      national: { used: 250000, available: 750000, total: 1000000 },
      international: { used: 100, available: 900, total: 1000, currency: "USD" },
      billingPeriod: "05 feb 2026",
      nextBillingDate: "20 feb 2026",
    });
  });

  it("usa la etiqueta por defecto y no inventa cupos cuando no hay datos", () => {
    expect(parseCreditCardInfo({})).toEqual({ label: "Tarjeta de Crédito BICE" });
  });

  it("completa con 0 los cupos que falten dentro de un bloque presente", () => {
    expect(parseCreditCardInfo({ nationalUsed: 5000 })).toEqual({
      label: "Tarjeta de Crédito BICE",
      national: { used: 5000, available: 0, total: 0 },
    });
  });
});
