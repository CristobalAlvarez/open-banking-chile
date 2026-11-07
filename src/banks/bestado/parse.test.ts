import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { movementContractViolations } from "../../testing/movement-contract.js";
import { parseRawMovements } from "./parse.js";

describe("parseRawMovements (BancoEstado)", () => {
  it("normaliza fecha y montos chilenos y marca el origen cuenta", () => {
    expect(
      parseRawMovements([
        {
          date: "15/01/2026",
          description: "COMPRA COMERCIO EJEMPLO",
          amount: "-$15.990",
          balance: "$1.234.010",
        },
      ])
    ).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: -15990,
        balance: 1234010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("usa balance 0 cuando la fila no trae saldo", () => {
    expect(
      parseRawMovements([
        {
          date: "16/01/2026",
          description: "TRANSFERENCIA RECIBIDA DE TERCERO",
          amount: "$500.000",
          balance: "",
        },
      ])
    ).toEqual([
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: 500000,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("descarta las filas sin monto", () => {
    expect(
      parseRawMovements([
        {
          date: "15/01/2026",
          description: "FILA SIN MONTO",
          amount: "",
          balance: "$1.000",
        },
      ])
    ).toEqual([]);
  });

  it("emite movimientos que cumplen el contrato de BankMovement", () => {
    const movements = parseRawMovements([
      {
        date: "15/01/2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "",
      },
    ]);

    expect(movements.flatMap(movementContractViolations)).toEqual([]);
  });
});
