import { describe, expect, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  extractCardMask,
  parseAccountRows,
  parseAvailableBalance,
  parseCmrRows,
  tagCardMovements,
} from "./parse.js";

describe("parseAccountRows", () => {
  it("normaliza la fecha y marca los movimientos como cuenta corriente", () => {
    const movements = parseAccountRows([
      {
        date: "15/01/2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 1234010,
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA EJEMPLO",
        amount: 500000,
        balance: 1734010,
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
        description: "TRANSFERENCIA RECIBIDA EJEMPLO",
        amount: 500000,
        balance: 1734010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("descarta filas sin monto y conserva las que lo tienen", () => {
    const movements = parseAccountRows([
      { date: "15/01/2026", description: "", amount: 0, balance: 0 },
      { date: "16/01/2026", description: "COMISION EJEMPLO", amount: 0, balance: 100 },
      { date: "17/01/2026", description: "COMPRA EJEMPLO", amount: -5000, balance: 95 },
    ]);

    expect(movements.map((m) => m.description)).toEqual(["COMPRA EJEMPLO"]);
  });
});

describe("parseCmrRows", () => {
  it("normaliza fecha, titular y cuotas sin tocar el resto del movimiento", () => {
    const [movement] = parseCmrRows([
      {
        date: "15/01/2026",
        description: "COMPRA EJEMPLO",
        amount: -120000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        owner: "TITULAR",
        installments: "1/3",
      },
    ]);

    expect(movement).toEqual({
      date: "15-01-2026",
      description: "COMPRA EJEMPLO",
      amount: -120000,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_unbilled,
      owner: "titular",
      installments: "01/03",
    });
  });

  it("deja pasar fechas y campos opcionales ausentes", () => {
    const [movement] = parseCmrRows([
      {
        date: "pendiente",
        description: "COMPRA EJEMPLO",
        amount: -1000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
      },
    ]);

    expect(movement).toEqual({
      date: "pendiente",
      description: "COMPRA EJEMPLO",
      amount: -1000,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_billed,
    });
  });
});

describe("parseAvailableBalance", () => {
  it("extrae el saldo disponible en pesos", () => {
    expect(parseAvailableBalance("Saldo disponible $ 1.234.567")).toBe(1234567);
    expect(parseAvailableBalance("saldo disponible: $987.654")).toBe(987654);
  });

  it("devuelve undefined cuando no hay saldo en el texto", () => {
    expect(parseAvailableBalance("Sin información")).toBeUndefined();
    expect(parseAvailableBalance("")).toBeUndefined();
    expect(parseAvailableBalance(null)).toBeUndefined();
    expect(parseAvailableBalance(undefined)).toBeUndefined();
  });
});

describe("extractCardMask", () => {
  it("extrae la máscara de cuatro dígitos de la etiqueta", () => {
    expect(extractCardMask("CMR Visa ****1234")).toBe("****1234");
  });

  it("devuelve undefined cuando la etiqueta no trae máscara", () => {
    expect(extractCardMask("CMR")).toBeUndefined();
    expect(extractCardMask("CMR ****12")).toBeUndefined();
  });
});

describe("tagCardMovements", () => {
  const movements = [
    {
      date: "15-01-2026",
      description: "COMPRA EJEMPLO",
      amount: -1000,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_unbilled,
    },
  ];

  it("agrega la tarjeta como copia sin mutar los movimientos originales", () => {
    const tagged = tagCardMovements(movements, "****1234");

    expect(tagged).toEqual([{ ...movements[0], card: "****1234" }]);
    expect(movements[0]).not.toHaveProperty("card");
  });

  it("deja los movimientos intactos cuando no hay máscara", () => {
    expect(tagCardMovements(movements, undefined)).toBe(movements);
  });
});
