import { describe, expect, it } from "vitest";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractBalance, extractRawMovements } from "./extract.js";
import { normalizeScotiabankMovements } from "./parse.js";

const accountPage = readFixture("./__fixtures__/account-movements.html", import.meta.url);

describe("extractRawMovements (tablas de cartola)", () => {
  it("lee las filas crudas de las tablas con encabezado de fecha", async () => {
    const raw = await extractRawMovements(pageFromHtml(accountPage));

    expect(raw).toEqual([
      {
        date: "15/01/2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: "-$15.990",
        balance: "$1.234.010",
      },
      {
        date: "15/01/2026",
        description: "COMISION MENSUAL",
        amount: "-$3.000",
        balance: "$1.231.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "$500.000",
        balance: "$1.731.010",
      },
      {
        date: "18/01/2026",
        description: "PAGO SERVICIO EJEMPLO",
        amount: "-$7.500",
        balance: "$1.723.510",
      },
    ]);
  });

  it("hereda la fecha de la fila anterior cuando la celda viene vacía", async () => {
    const raw = await extractRawMovements(pageFromHtml(accountPage));
    const commission = raw.find((r) => r.description === "COMISION MENSUAL");
    expect(commission?.date).toBe("15/01/2026");
  });

  it("ignora filas sin monto y tablas sin encabezado de fecha", async () => {
    const raw = await extractRawMovements(pageFromHtml(accountPage));
    expect(raw.map((r) => r.description)).toEqual([
      "COMPRA SUPERMERCADO EJEMPLO",
      "COMISION MENSUAL",
      "TRANSFERENCIA RECIBIDA DE TERCERO",
      "PAGO SERVICIO EJEMPLO",
    ]);
  });

  it("al normalizar, los cargos quedan negativos y los abonos positivos", async () => {
    const movements = normalizeScotiabankMovements(
      await extractRawMovements(pageFromHtml(accountPage))
    );

    expect(movements.map((m) => [m.date, m.description, m.amount, m.balance])).toEqual([
      ["15-01-2026", "COMPRA SUPERMERCADO EJEMPLO", -15990, 1234010],
      ["15-01-2026", "COMISION MENSUAL", -3000, 1231010],
      ["16-01-2026", "TRANSFERENCIA RECIBIDA DE TERCERO", 500000, 1731010],
      ["18-01-2026", "PAGO SERVICIO EJEMPLO", -7500, 1723510],
    ]);
  });

  it("devuelve [] cuando la página no trae tablas ni tarjetas de movimientos", async () => {
    expect(await extractRawMovements(pageFromHtml("<p>Sin datos</p>"))).toEqual([]);
  });
});

describe("extractBalance", () => {
  it("lee el saldo disponible del texto de la página", async () => {
    const page = pageFromHtml("<p>Saldo disponible $1.234.567</p>");
    expect(await extractBalance(page)).toBe(1234567);
  });

  it("devuelve undefined si la página no muestra un saldo", async () => {
    expect(await extractBalance(pageFromHtml("<p>Sin saldo</p>"))).toBeUndefined();
  });
});
