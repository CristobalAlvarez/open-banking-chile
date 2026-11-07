import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { movementContractViolations } from "../../testing/movement-contract.js";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractRawMovements } from "./extract.js";
import { parseRawMovements } from "./parse.js";

const table = readFixture("./__fixtures__/movements-table.html", import.meta.url);
const tableMonto = readFixture("./__fixtures__/movements-table-monto.html", import.meta.url);
const cards = readFixture("./__fixtures__/movements-cards.html", import.meta.url);

describe("extractRawMovements (tabla de CuentaRUT)", () => {
  it("lee fecha, descripción, cargo firmado y abono con su saldo", async () => {
    const raw = await extractRawMovements(pageFromHtml(table));

    expect(raw.slice(0, 2)).toEqual([
      {
        date: "15/01/2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "$1.734.010",
      },
    ]);
  });

  it("omite filas sin fecha y deja el saldo vacío cuando no viene", async () => {
    const raw = await extractRawMovements(pageFromHtml(table));

    expect(raw.map((r) => r.description)).toEqual([
      "COMPRA COMERCIO EJEMPLO",
      "TRANSFERENCIA RECIBIDA DE TERCERO",
      "COMISION MENSUAL",
    ]);
    expect(raw.at(-1)?.balance).toBe("");
  });

  it("normaliza la tabla a movimientos que cumplen el contrato", async () => {
    const movements = parseRawMovements(await extractRawMovements(pageFromHtml(table)));

    expect(movements.map((m) => m.amount)).toEqual([-15990, 500000, -3000]);
    expect(movements.every((m) => m.source === MOVEMENT_SOURCE.account)).toBe(true);
    expect(movements.flatMap(movementContractViolations)).toEqual([]);
  });

  it("devuelve [] cuando la página no trae movimientos", async () => {
    expect(await extractRawMovements(pageFromHtml("<p>Sin datos</p>"))).toEqual([]);
  });
});

describe("extractRawMovements (tabla con una sola columna de monto)", () => {
  it("lee el monto firmado tal cual viene", async () => {
    const raw = await extractRawMovements(pageFromHtml(tableMonto));

    expect(raw).toEqual([
      {
        date: "15/01/2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "$1.734.010",
      },
    ]);
  });
});

describe("extractRawMovements (tarjetas del dashboard)", () => {
  it("toma el primer monto como monto y el último como saldo", async () => {
    const raw = await extractRawMovements(pageFromHtml(cards));

    expect(raw).toEqual([
      {
        date: "15/01/2026",
        description: "COMPRA COMERCIO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "$1.734.010",
      },
    ]);
  });
});
