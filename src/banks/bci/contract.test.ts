import { describe, it } from "vitest";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { normalizeBciApiMovements } from "./parse.js";

describe("contrato de BankMovement (bci)", () => {
  it("API cuenta emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeBciApiMovements([
        {
          movimientos: [
            { fechaMovimiento: "2026-01-15T00:00:00", monto: "15990", tipo: "C", glosa: "Lider" },
            {
              fechaMovimiento: "2026-02-10T00:00:00",
              monto: "500000",
              tipo: "A",
              glosa: "Sueldo",
            },
          ],
        },
      ])
    );
  });
});
