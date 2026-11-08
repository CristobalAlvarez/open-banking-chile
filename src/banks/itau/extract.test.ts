import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { extractAccountMovements } from "../../steps/extraction.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractBilledRows, extractUnbilledRows } from "./extract.js";

const unbilled = readFixture("./__fixtures__/tc-unbilled.html", import.meta.url);
const billedNational = readFixture("./__fixtures__/tc-billed-national.html", import.meta.url);
const billedInternational = readFixture(
  "./__fixtures__/tc-billed-international.html",
  import.meta.url
);
const accountTable = readFixture("./__fixtures__/account-movements.html", import.meta.url);

describe("extractUnbilledRows", () => {
  it("lee la tabla nacional (CLP) aunque venga envuelta en una tabla de layout", async () => {
    const movements = await extractUnbilledRows(pageFromHtml(unbilled), "national");

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
        date: "10-10-2026",
        description: "COMERCIO EJEMPLO DOS 07-10 CUOTA",
        amount: -80223,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: "07/10",
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
    const movements = await extractUnbilledRows(pageFromHtml(unbilled), "national");
    const commission = movements.find((m) => m.description === "COMISION EJEMPLO");
    expect(commission?.date).toBe("11-10-2026");
  });

  it("lee la tabla internacional en USD y descarta las filas en pesos", async () => {
    const movements = await extractUnbilledRows(pageFromHtml(unbilled), "international");

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

describe("extractBilledRows", () => {
  it("lee la cuota actual y total de cada fila (pago único incluido) y el valor cuota como monto", async () => {
    const movements = await extractBilledRows(pageFromHtml(billedNational), "national");

    // Los títulos de sección ("1.Total operaciones", …) y el encabezado no son movimientos.
    expect(movements).toEqual([
      {
        date: "05-10-2026",
        description: "COMERCIO EJEMPLO UNO",
        amount: -63111,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "01/01",
      },
      {
        date: "17-03-2026",
        description: "COMERCIO EJEMPLO DOS tasa int. 2,76%",
        amount: -80223,
        totalAmount: 802230,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "06/10",
      },
      {
        date: "02-10-2026",
        description: "COMERCIO EJEMPLO TRES",
        amount: -100000,
        totalAmount: 1200000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "01/12",
      },
      {
        date: "20-07-2026",
        description: "COMERCIO EJEMPLO CUATRO",
        amount: -30000,
        totalAmount: 90000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "03/03",
      },
      {
        date: "01-10-2026",
        description: "COMISION EJEMPLO",
        amount: -24600,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "01/01",
      },
      {
        date: "26-09-2026",
        description: "MONTO CANCELADO",
        amount: 300000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        installments: "01/01",
      },
    ]);
  });

  it("lee el estado de cuenta internacional en USD sin inventar cuotas ni tomar los subtotales", async () => {
    const movements = await extractBilledRows(pageFromHtml(billedInternational), "international");

    expect(movements).toEqual([
      {
        date: "26-09-2026",
        description: "MONTO CANCELADO",
        amount: 44.77,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        currency: "USD",
      },
      {
        date: "02-10-2026",
        description: "SUSCRIPCION EJEMPLO",
        amount: -12.34,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        currency: "USD",
      },
      {
        date: "04-10-2026",
        description: "TIENDA EJEMPLO",
        amount: -39.76,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        currency: "USD",
      },
    ]);
  });

  it("devuelve [] cuando la página no trae la tabla de ese estado de cuenta", async () => {
    const page = pageFromHtml("<p>Sin datos</p>");
    expect(await extractBilledRows(page, "national")).toEqual([]);
    expect(await extractBilledRows(page, "international")).toEqual([]);
  });
});

describe("cartola de la cuenta corriente (markup de Itaú)", () => {
  it("lee la descripción bajo «Movimientos», cargos negativos y abonos positivos con su saldo", async () => {
    const movements = await extractAccountMovements(pageFromHtml(accountTable));

    expect(movements).toEqual([
      {
        date: "15-10-2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: -15990,
        balance: 1234010,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-10-2026",
        description: "TRANSFERENCIA DE TERCERO EJEMPLO",
        amount: 500000,
        balance: 1734010,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "17-10-2026",
        description: "PAGO TARJETA DE CREDITO EJEMPLO",
        amount: -1200000,
        balance: 534010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });
});
