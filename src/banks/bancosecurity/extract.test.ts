import { describe, it, expect } from "vitest";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractFromContext } from "./extract.js";

const table = readFixture("./__fixtures__/movements-table.html", import.meta.url);

describe("extractFromContext (tabla de movimientos)", () => {
  it("lee cargos y abonos como texto, con fecha y saldo crudos", async () => {
    expect(await extractFromContext(pageFromHtml(table))).toEqual([
      {
        date: "15/01/2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: "-15.990",
        balance: "$1.234.010",
      },
      {
        date: "16/01/2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: "500.000",
        balance: "$1.734.010",
      },
      {
        date: "18/01/2026",
        description: "CARGO SIN SALDO",
        amount: "-2.000",
        balance: "",
      },
    ]);
  });

  it("ignora filas sin fecha o sin monto y tablas sin encabezado de fecha", async () => {
    const rows = await extractFromContext(pageFromHtml(table));
    expect(rows.map((r) => r.description)).toEqual([
      "COMPRA SUPERMERCADO EJEMPLO",
      "TRANSFERENCIA RECIBIDA DE TERCERO",
      "CARGO SIN SALDO",
    ]);
  });

  it("acepta encabezados en <th>", async () => {
    const html = `
      <table>
        <tr>
          <th>Fecha</th>
          <th>Detalle</th>
          <th>Cargo</th>
          <th>Saldo</th>
        </tr>
        <tr>
          <td>19/01/2026</td>
          <td>PAGO SERVICIO EJEMPLO</td>
          <td>10.000</td>
          <td>1.721.010</td>
        </tr>
      </table>`;

    expect(await extractFromContext(pageFromHtml(html))).toEqual([
      {
        date: "19/01/2026",
        description: "PAGO SERVICIO EJEMPLO",
        amount: "-10.000",
        balance: "1.721.010",
      },
    ]);
  });

  it("devuelve [] cuando la página no trae tablas de movimientos", async () => {
    expect(await extractFromContext(pageFromHtml("<p>Sin datos</p>"))).toEqual([]);
  });
});
