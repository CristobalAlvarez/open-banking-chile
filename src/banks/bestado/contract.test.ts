import { describe, it } from "vitest";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { parseRawMovements } from "./parse.js";

describe("contrato de BankMovement (bestado)", () => {
  it("las filas crudas de CuentaRUT se normalizan cumpliendo el contrato", () => {
    expectMovementContract(
      parseRawMovements([
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
          balance: "$1.734.010",
        },
      ])
    );
  });
});
