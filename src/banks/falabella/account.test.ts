import { describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractMovementsFromPage } from "./account.js";

const table = readFixture("./__fixtures__/account-movements.html", import.meta.url);
const page = pageFromHtml(table) as unknown as Page;

describe("extractMovementsFromPage (tabla de cartola)", () => {
  it("lee cargos como negativos y abonos como positivos, con su saldo", async () => {
    const movements = await extractMovementsFromPage(page);

    expect(movements.slice(0, 2)).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 1234010,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: 500000,
        balance: 1734010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("hereda la fecha de la fila anterior cuando la celda viene vacía", async () => {
    const movements = await extractMovementsFromPage(page);
    const commission = movements.find((m) => m.description === "COMISION MENSUAL");

    expect(commission).toMatchObject({ date: "16-01-2026", amount: -3000 });
  });

  it("ignora filas sin monto", async () => {
    const movements = await extractMovementsFromPage(page);

    expect(movements.map((m) => m.description)).toEqual([
      "COMPRA SUPERMERCADO EJEMPLO",
      "TRANSFERENCIA RECIBIDA DE TERCERO",
      "COMISION MENSUAL",
    ]);
  });

  it("devuelve [] cuando la página no trae movimientos", async () => {
    const empty = pageFromHtml("<p>Sin datos</p>") as unknown as Page;

    expect(await extractMovementsFromPage(empty)).toEqual([]);
  });
});
