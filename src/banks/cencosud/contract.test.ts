import { describe, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { parseCencosudMovements } from "./parse.js";

describe("contrato de BankMovement (cencosud)", () => {
  it("las filas normalizadas cumplen el contrato", () => {
    expectMovementContract(
      parseCencosudMovements(
        [
          {
            date: "15/01/2026",
            description: "Compra de prueba",
            amount: -159990,
            installments: "Cuota 02/06",
            source: MOVEMENT_SOURCE.credit_card_unbilled,
          },
          {
            date: "16/01/2026",
            description: "Pago de prueba",
            amount: 50000,
            source: MOVEMENT_SOURCE.credit_card_unbilled,
          },
          {
            date: "2026-02-05",
            description: "Compra facturada de prueba",
            amount: -25000,
            installments: "1/3",
            source: MOVEMENT_SOURCE.credit_card_billed,
          },
        ],
        MOVEMENT_SOURCE.credit_card_unbilled
      )
    );
  });
});
