import { describe, expect, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeScotiabankMovements, parseBalanceText } from "./parse.js";

describe("normalizeScotiabankMovements", () => {
  it("marca los cargos como negativos y los abonos como positivos, con su saldo", () => {
    const movements = normalizeScotiabankMovements([
      {
        date: "15/01/2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "$1.734.010",
      },
    ]);

    expect(movements).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 1234010,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: 500000,
        balance: 1734010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("descarta montos en cero y deja balance 0 cuando la celda viene vacía", () => {
    const movements = normalizeScotiabankMovements([
      { date: "17/01/2026", description: "SIN MONTO", amount: "", balance: "$1.000" },
      { date: "18/01/2026", description: "MONTO CERO", amount: "$0", balance: "$1.000" },
      { date: "19/01/2026", description: "CARGO SIN SALDO", amount: "-$7.500", balance: "" },
    ]);

    expect(movements).toEqual([
      {
        date: "19-01-2026",
        description: "CARGO SIN SALDO",
        amount: -7500,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("deduplica movimientos con la misma fecha, descripción y monto", () => {
    const raw = {
      date: "15/01/2026",
      description: "COMPRA SUPERMERCADO EJEMPLO",
      amount: "-$15.990",
      balance: "$1.234.010",
    };

    expect(normalizeScotiabankMovements([raw, { ...raw, balance: "$999.999" }])).toHaveLength(1);
  });

  it("devuelve [] sin filas", () => {
    expect(normalizeScotiabankMovements([])).toEqual([]);
  });
});

describe("parseBalanceText", () => {
  it("lee el saldo disponible y quita los separadores de miles", () => {
    expect(parseBalanceText("Cuenta corriente\nSaldo disponible $1.234.567\n")).toBe(1234567);
  });

  it("lee el saldo actual cuando no hay saldo disponible", () => {
    expect(parseBalanceText("Saldo actual: $ 500")).toBe(500);
  });

  it("devuelve undefined si no hay un patrón de saldo", () => {
    expect(parseBalanceText("Sin información de saldo")).toBeUndefined();
  });
});
