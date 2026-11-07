import { describe, it } from "vitest";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { parseTxtMovements } from "./parse.js";

/** Línea sintética con el formato fijo del TXT de cartola histórica (ver `parse.ts`). */
function txtLine(
  date: string,
  description: string,
  type: "C" | "A",
  amount: string,
  balance: string
): string {
  return `2${date.padEnd(10)}${description.padEnd(50)}000000001${type}+${amount.padStart(12)}${balance.padStart(18)}`;
}

describe("contrato de BankMovement (bancosecurity)", () => {
  it("la cartola TXT emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      parseTxtMovements(
        [
          txtLine("15/01/2026", "COMPRA SUPERMERCADO EJEMPLO", "C", "15.990", "1.234.010"),
          txtLine("16/01/2026", "TRANSFERENCIA RECIBIDA DE TERCERO", "A", "500.000", "1.734.010"),
        ].join("\n")
      )
    );
  });
});
