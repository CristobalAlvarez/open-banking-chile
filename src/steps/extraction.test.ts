import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../core/types.js";
import { movementContractViolations } from "../testing/movement-contract.js";
import { pageFromHtml, readFixture } from "../testing/dom.js";
import { extractAccountMovements } from "./extraction.js";

const table = readFixture("./__fixtures__/account-movements.html", import.meta.url);

describe("extractAccountMovements (tabla de cartola)", () => {
  it("lee cargos como negativos y abonos como positivos, con su saldo", async () => {
    const movements = await extractAccountMovements(pageFromHtml(table));

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
    const movements = await extractAccountMovements(pageFromHtml(table));
    const commission = movements.find((m) => m.description === "COMISION MENSUAL");
    expect(commission).toMatchObject({ date: "16-01-2026", amount: -3000 });
  });

  it("ignora filas sin monto, tablas sin encabezado de fecha y duplicados exactos", async () => {
    const movements = await extractAccountMovements(pageFromHtml(table));
    expect(movements.map((m) => m.description)).toEqual([
      "COMPRA SUPERMERCADO EJEMPLO",
      "TRANSFERENCIA RECIBIDA DE TERCERO",
      "COMISION MENSUAL",
    ]);
  });

  it("emite movimientos que cumplen el contrato de BankMovement", async () => {
    const movements = await extractAccountMovements(pageFromHtml(table));
    expect(movements.flatMap(movementContractViolations)).toEqual([]);
  });

  it("devuelve [] cuando la página no trae movimientos", async () => {
    expect(await extractAccountMovements(pageFromHtml("<p>Sin datos</p>"))).toEqual([]);
  });
});
