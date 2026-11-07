import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractUnbilledRows } from "./extract.js";

const html = readFixture("./__fixtures__/tc-unbilled.html", import.meta.url);
const page = () => pageFromHtml(html);

describe("extractUnbilledRows", () => {
  it("lee la tabla nacional (CLP) aunque venga envuelta en una tabla de layout", async () => {
    const movements = await extractUnbilledRows(page(), "national");

    expect(movements).toEqual([
      {
        date: "09-10-2026",
        description: "COMERCIO EJEMPLO UNO",
        amount: -799980,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: "00/12",
      },
      {
        date: "11-10-2026",
        description: "COMISION EJEMPLO",
        amount: -1990,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: undefined,
      },
      {
        date: "12-10-2026",
        description: "ABONO EJEMPLO",
        amount: 5405,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: undefined,
      },
    ]);
  });

  it("usa la fecha de posteo cuando la fila no trae celda de fecha de transacción", async () => {
    const movements = await extractUnbilledRows(page(), "national");
    const commission = movements.find((m) => m.description === "COMISION EJEMPLO");
    expect(commission?.date).toBe("11-10-2026");
  });

  it("lee la tabla internacional en USD y descarta las filas en pesos", async () => {
    const movements = await extractUnbilledRows(page(), "international");

    expect(movements).toEqual([
      {
        date: "17-10-2026",
        description: "SUSCRIPCION EJEMPLO",
        amount: -47.61,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: undefined,
        currency: "USD",
      },
      {
        date: "18-10-2026",
        description: "PAGO EJEMPLO",
        amount: 10,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: undefined,
        currency: "USD",
      },
    ]);
  });
});
