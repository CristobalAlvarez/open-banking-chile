import { describe, expect, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { DebugLog } from "../../core/debug-log.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import {
  extractAccountBalance,
  extractCreditCardInfo,
  extractCurrentMonthMovements,
  extractHistoricalMovements,
  extractTcMovementsFromPage,
} from "./extract.js";

const accountPage = readFixture("./__fixtures__/account-movements.html", import.meta.url);
const creditCardPage = readFixture("./__fixtures__/credit-card.html", import.meta.url);

describe("extractAccountBalance", () => {
  it("lee el saldo de la cabecera del dashboard", async () => {
    expect(await extractAccountBalance(pageFromHtml(accountPage))).toBe(1234567);
  });

  it("devuelve undefined si no hay cabecera", async () => {
    expect(await extractAccountBalance(pageFromHtml("<p>Sin saldo</p>"))).toBeUndefined();
  });
});

describe("extractCurrentMonthMovements (tabla del mes actual)", () => {
  it("lee fecha, categoría, descripción y monto de cada fila", async () => {
    const movements = await extractCurrentMonthMovements(pageFromHtml(accountPage));

    expect(movements).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA EJEMPLO",
        amount: 500000,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("devuelve [] cuando la página no trae la tabla", async () => {
    expect(await extractCurrentMonthMovements(pageFromHtml("<p>Sin datos</p>"))).toEqual([]);
  });
});

describe("extractHistoricalMovements (tabla de cartolas)", () => {
  it("usa las columnas 0, 1, 3 y 4 de la tabla histórica", async () => {
    const movements = await extractHistoricalMovements(pageFromHtml(accountPage), new DebugLog());

    expect(movements.map((m) => [m.date, m.description, m.amount])).toEqual([
      ["10-02-2026", "PAGO TARJETA EJEMPLO", -1000],
      ["11-02-2026", "ABONO EJEMPLO", 2000],
    ]);
  });

  it("registra en el log cuando no encuentra la tabla", async () => {
    const debugLog = new DebugLog();
    const movements = await extractHistoricalMovements(
      pageFromHtml("<p>Sin cartolas</p>"),
      debugLog
    );

    expect(movements).toEqual([]);
    expect(debugLog).toContain("  Historical table not found");
  });
});

describe("extractCreditCardInfo", () => {
  it("lee etiqueta, cupos y fechas de facturación", async () => {
    const debugLog = new DebugLog();
    const { balance, movements } = await extractCreditCardInfo(
      pageFromHtml(creditCardPage),
      debugLog
    );

    expect(balance).toEqual({
      label: "Visa****1234",
      national: { used: 250000, available: 750000, total: 1000000 },
      international: { used: 100, available: 900, total: 1000, currency: "USD" },
      billingPeriod: "05 feb 2026",
      nextBillingDate: "20 feb 2026",
    });
    expect(movements).toEqual([]);
    expect(debugLog).toContain("TC: Card=Visa****1234, Nacional used=250000, Intl used=100");
  });
});

describe("extractTcMovementsFromPage (app-transaction-row)", () => {
  it("lee fecha, detalle, cuotas y monto; ignora filas con fecha inválida", async () => {
    const movements = await extractTcMovementsFromPage(
      pageFromHtml(creditCardPage),
      MOVEMENT_SOURCE.credit_card_unbilled
    );

    expect(movements).toEqual([
      {
        date: "10-01-2026",
        description: "COMPRA EJEMPLO",
        amount: -120000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: "03/12",
      },
      {
        date: "11-01-2026",
        description: "PAGO TARJETA",
        amount: 50000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
        installments: undefined,
      },
    ]);
  });
});
