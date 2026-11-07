import { describe, it, expect } from "vitest";
import type { Page } from "puppeteer-core";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractCardLabel, extractDashboardBalance, extractOnePage } from "./extract.js";

const unbilledTable = readFixture("./__fixtures__/movements-table.html", import.meta.url);
const billedTable = readFixture("./__fixtures__/movements-table-billed.html", import.meta.url);
const dashboard = readFixture("./__fixtures__/dashboard-balance.html", import.meta.url);
const cardLabelPage = readFixture("./__fixtures__/card-label.html", import.meta.url);

/** `pageFromHtml` solo implementa `evaluate`; la espera de filas ya está cubierta por el fixture. */
function fixturePage(html: string): Page {
  const page = pageFromHtml(html);
  Object.assign(page, { waitForSelector: async () => undefined });
  return page;
}

describe("extractOnePage", () => {
  it("lee la tabla no facturada, invierte el signo y normaliza fecha y cuotas", async () => {
    const movements = await extractOnePage(
      fixturePage(unbilledTable),
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

  it("detecta la columna de monto aunque no sea la última", async () => {
    const movements = await extractOnePage(
      fixturePage(billedTable),
      MOVEMENT_SOURCE.credit_card_billed
    );

    expect(movements).toEqual([
      {
        date: "05-02-2026",
        description: "Compra facturada de prueba",
        amount: -25000,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
      },
    ]);
  });
});

describe("extractDashboardBalance", () => {
  it("lee utilizado, disponible y cupo total de la tarjeta de cupos", async () => {
    expect(await extractDashboardBalance(pageFromHtml(dashboard))).toEqual({
      used: 1234567,
      available: 8765433,
      total: 10000000,
    });
  });

  it("devuelve null cuando no hay tarjeta de cupos", async () => {
    expect(await extractDashboardBalance(pageFromHtml("<p>Sin datos</p>"))).toBeNull();
  });
});

describe("extractCardLabel", () => {
  it("lee la etiqueta enmascarada del encabezado", async () => {
    expect(await extractCardLabel(pageFromHtml(cardLabelPage))).toBe("Mastercard Black ●●●● 7779");
  });

  it("usa la etiqueta por defecto cuando no hay número enmascarado", async () => {
    expect(await extractCardLabel(pageFromHtml("<p>Sin tarjeta</p>"))).toBe("Tarjeta Cencosud");
  });
});
