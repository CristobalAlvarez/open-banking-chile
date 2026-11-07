import { describe, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { parseCurrentMonthMovements, parseHistoricalMovements, parseTcMovements } from "./parse.js";

describe("contrato de BankMovement (bice)", () => {
  it("movimientos del mes actual de la cuenta", () => {
    expectMovementContract(
      parseCurrentMonthMovements([
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
      ])
    );
  });

  it("movimientos históricos de la cuenta", () => {
    expectMovementContract(
      parseHistoricalMovements([
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
      ])
    );
  });

  it("movimientos de tarjeta de crédito", () => {
    expectMovementContract(
      parseTcMovements(
        [
          {
            date: "10 ene 2026",
            description: "COMPRA EJEMPLO",
            amount: "$120.000",
            installments: "3 de 12",
          },
          {
            date: "11 ene 2026",
            description: "PAGO TARJETA",
            amount: "$50.000",
            installments: "1 de 1",
          },
        ],
        MOVEMENT_SOURCE.credit_card_unbilled
      )
    );
  });
});
