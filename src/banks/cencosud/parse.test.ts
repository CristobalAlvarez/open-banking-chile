import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { parseCencosudMovements } from "./parse.js";

describe("parseCencosudMovements", () => {
  it("normaliza fecha, signo, cuotas y balance de las filas crudas", () => {
    const movements = parseCencosudMovements(
      [
        {
          date: "15/01/2026",
          description: "Compra de prueba",
          amount: -159990,
          installments: "Cuota 01/03",
          source: MOVEMENT_SOURCE.credit_card_unbilled,
        },
        {
          date: "16/1/2026",
          description: "Pago de prueba",
          amount: 50000,
          source: MOVEMENT_SOURCE.credit_card_unbilled,
        },
      ],
      MOVEMENT_SOURCE.credit_card_unbilled
    );

    expect(movements).toEqual([
      {
        date: "15-01-2026",
        description: "Compra de prueba",
        amount: -159990,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: "01/03",
      },
      {
        date: "16-01-2026",
        description: "Pago de prueba",
        amount: 50000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
      },
    ]);
  });

  it("acepta fechas ISO y no toca montos ni descripciones", () => {
    const movements = parseCencosudMovements(
      [
        {
          date: "2026-01-20T10:00:00",
          description: "Reembolso de prueba",
          amount: 1234,
          source: MOVEMENT_SOURCE.credit_card_billed,
        },
      ],
      MOVEMENT_SOURCE.credit_card_billed
    );

    expect(movements[0]).toMatchObject({
      date: "20-01-2026",
      description: "Reembolso de prueba",
      amount: 1234,
      source: MOVEMENT_SOURCE.credit_card_billed,
    });
  });

  it("devuelve [] sin filas", () => {
    expect(parseCencosudMovements([], MOVEMENT_SOURCE.credit_card_unbilled)).toEqual([]);
  });
});
