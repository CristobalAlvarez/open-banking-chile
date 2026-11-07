import { describe, it } from "vitest";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { normalizeScotiabankMovements } from "./parse.js";

describe("contrato de BankMovement (scotiabank)", () => {
  it("las filas de la cartola emiten movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeScotiabankMovements([
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
      ])
    );
  });
});
