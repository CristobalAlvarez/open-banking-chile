import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { fetchAccountMovements, fetchCreditCardData } from "./extract.js";

vi.mock("../../core/delay.js", () => ({ delay: async () => {} }));

// ─── fetchAccountMovements: paginación real de la cartola ────────

type CartolaRow = {
  id: string;
  descripcion: string;
  monto: number;
  saldo: number;
  tipo: string;
  fechaContable: string;
};

type CartolaPayload = { movimientos: CartolaRow[]; pagina: Array<Record<string, unknown>> };

function cartolaRows(count: number, start: number, date: string): CartolaRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mov-${start + i}`,
    descripcion: `movimiento ${start + i}`,
    monto: i % 2 === 0 ? 1000 : -1000,
    saldo: 100000 - i,
    tipo: i % 2 === 0 ? "abono" : "cargo",
    fechaContable: date,
  }));
}

function fakeBchilePage(pages: Record<number, CartolaPayload>) {
  const offsets: number[] = [];
  const page = {
    url: () => "https://portalpersonas.bancochile.cl/persona/",
    goto: async () => undefined,
    evaluate: async (_fn: unknown, url: string, bodyStr: string) => {
      if (url.includes("getConfigConsultaMovimientos")) return {};
      if (!url.includes("getCartola")) throw new Error(`unexpected ${url}`);
      const body = JSON.parse(bodyStr) as { cabecera: { paginacionDesde: number } };
      const offset = body.cabecera.paginacionDesde;
      offsets.push(offset);
      return pages[offset] ?? { movimientos: [], pagina: [{ totalRegistros: 0, masPaginas: "N" }] };
    },
  };
  return { page: page as unknown as Page, offsets };
}

const products = [
  {
    id: "1",
    numero: "123456",
    mascara: "****1234",
    codigo: "CTD",
    codigoMoneda: "CLP",
    label: "Cuenta Corriente",
    tipo: "cuenta",
    claseCuenta: "CCNMN1",
    tarjetaHabiente: null,
    descripcionLogo: "Cuenta Corriente",
    tipoCliente: "T",
  },
] as unknown as Parameters<typeof fetchAccountMovements>[1];

describe("fetchAccountMovements", () => {
  it("pagina hasta totalRegistros aunque masPaginas venga en N", async () => {
    const first = cartolaRows(100, 0, "02-10-2026");
    const second = cartolaRows(50, 100, "01-10-2026");
    const { page, offsets } = fakeBchilePage({
      1: {
        movimientos: first,
        pagina: [{ totalRegistros: "150", cantidadRegistros: "100", masPaginas: "N" }],
      },
      101: {
        movimientos: second,
        pagina: [{ totalRegistros: "150", cantidadRegistros: "100", masPaginas: "N" }],
      },
    });

    const debug: string[] = [];
    const result = await fetchAccountMovements(page, products, "Nombre", "11111111-1", debug);

    expect(result.movements).toHaveLength(150);
    expect(offsets).toEqual([1, 101]);
    expect(debug.join("\n")).toContain("cartola p2");
    expect(debug.join("\n")).toContain("cartola ****1234: 150 movimientos");
    expect(debug.join("\n")).toContain("desde 01-10-2026 hasta 02-10-2026");
  });

  it("no pide una página de más cuando totalRegistros ya se cubrió", async () => {
    const { page, offsets } = fakeBchilePage({
      1: {
        movimientos: cartolaRows(73, 0, "01-10-2026"),
        pagina: [{ totalRegistros: "73", masPaginas: "N" }],
      },
    });

    const result = await fetchAccountMovements(page, products, "Nombre", "11111111-1", []);

    expect(result.movements).toHaveLength(73);
    expect(offsets).toEqual([1]);
  });

  it("corta si la API devuelve la misma página (offset ignorado)", async () => {
    const first = cartolaRows(100, 0, "01-10-2026");
    const { page, offsets } = fakeBchilePage({
      1: { movimientos: first, pagina: [{ totalRegistros: "150", masPaginas: "S" }] },
      101: { movimientos: first, pagina: [{ totalRegistros: "150", masPaginas: "S" }] },
    });

    const result = await fetchAccountMovements(page, products, "Nombre", "11111111-1", []);

    expect(result.movements).toHaveLength(100);
    expect(offsets).toEqual([1, 101]);
  });

  it("no corta antes del hueco: sigue paginando aunque ya cubra since", async () => {
    const rows = [cartolaRows(1, 0, "20-10-2026")[0], cartolaRows(1, 1, "10-10-2026")[0]];
    const { page, offsets } = fakeBchilePage({
      1: { movimientos: rows, pagina: [{ totalRegistros: "200", masPaginas: "S" }] },
    });

    const debug: string[] = [];
    const result = await fetchAccountMovements(
      page,
      products,
      "Nombre",
      "11111111-1",
      debug,
      "15-10-2026"
    );

    expect(result.movements).toHaveLength(2);
    expect(offsets).toEqual([1, 3]);
    expect(debug.join("\n")).toContain("cubre since 15-10-2026");
  });

  it("advierte si la cartola no alcanza el since pedido", async () => {
    const { page, offsets } = fakeBchilePage({
      1: {
        movimientos: cartolaRows(2, 0, "20-10-2026"),
        pagina: [{ totalRegistros: "2", masPaginas: "N" }],
      },
    });

    const debug: string[] = [];
    await fetchAccountMovements(page, products, "Nombre", "11111111-1", debug, "01-10-2026");

    expect(offsets).toEqual([1]);
    expect(debug.join("\n")).toContain("no alcanza since 01-10-2026");
  });
});

// ─── fetchCreditCardData: varias tarjetas sobre la misma cuenta ──

describe("fetchCreditCardData", () => {
  const unbilled = {
    fechaProximaFacturacionCalendario: "15/12/2026",
    listaMovNoFactur: [
      {
        origenTransaccion: "x",
        fechaTransaccionString: "01/11/2026",
        montoCompra: 1000,
        glosaTransaccion: "COMPRA A",
        despliegueCuotas: "01/01",
      },
      {
        origenTransaccion: "x",
        fechaTransaccionString: "02/11/2026",
        montoCompra: 2500,
        glosaTransaccion: "COMPRA B",
        despliegueCuotas: "03 de 12",
      },
    ],
  };

  function fakeCardsPage(cardNumbers: string[], movementsFor: (index: number) => unknown) {
    let nextCard = 0;
    const page = {
      evaluate: async (_fn: unknown, url: string) => {
        if (url.includes("informacion-tarjetas")) {
          return cardNumbers.map((numero, i) => ({
            titular: true,
            marca: `Marca${i}`,
            tipo: "Black",
            idProducto: `id${i}`,
            numero,
          }));
        }
        if (url.includes("obtener-saldo")) {
          return {
            cupoTotalNacional: 10,
            cupoUtilizadoNacional: 4,
            cupoDisponibleNacional: 6,
            cupoTotalInternacional: 0,
            cupoUtilizadoInternacional: 0,
            cupoDisponibleInternacional: 0,
          };
        }
        if (url.includes("movimientos-no-facturados")) return movementsFor(nextCard++);
        if (url.includes("fechas-facturacion")) {
          return {
            existenEstadosDeCuenta: false,
            numeroCuenta: null,
            listaNacional: [],
            listaInternacional: [],
          };
        }
        throw new Error(`unexpected ${url}`);
      },
    };
    return page as unknown as Page;
  }

  it("informa una sola vez los movimientos que el portal repite en cada tarjeta de la cuenta", async () => {
    const page = fakeCardsPage(["****1111", "****2222", "****3333"], () => unbilled);
    const debug: string[] = [];

    const { movements, creditCards } = await fetchCreditCardData(page, "Nombre", debug as never);

    expect(creditCards).toHaveLength(3);
    expect(movements).toHaveLength(2);
    expect(new Set(movements.map((m) => m.card))).toEqual(new Set(["****1111"]));
    expect(debug.join("\n")).toContain("mismos movimientos que otra tarjeta");
  });

  it("conserva los movimientos de cada tarjeta cuando son distintos", async () => {
    const other = {
      ...unbilled,
      listaMovNoFactur: [{ ...unbilled.listaMovNoFactur[0], glosaTransaccion: "COMPRA C" }],
    };
    const page = fakeCardsPage(["****1111", "****2222"], (i) => (i === 0 ? unbilled : other));

    const { movements } = await fetchCreditCardData(page, "Nombre", [] as never);

    expect(movements.map((m) => m.card)).toEqual(["****1111", "****1111", "****2222"]);
  });

  it("normaliza las cuotas del portal a NN/NN", async () => {
    const page = fakeCardsPage(["****1111"], () => unbilled);

    const { movements } = await fetchCreditCardData(page, "Nombre", [] as never);

    expect(movements.map((m) => m.installments)).toEqual(["01/01", "03/12"]);
  });
});

describe("fetchCreditCardData: tarjeta internacional", () => {
  const intlUnbilled = {
    fechaProximaFacturacionCalendario: "15/12/2026",
    listaMovNoFactur: [
      {
        origenTransaccion: "INT",
        codigoMonedaOrigen: "840",
        fechaTransaccionString: "01/11/2026",
        montoCompra: 12.5,
        glosaTransaccion: "COMPRA USD",
        despliegueCuotas: "01/01",
      },
      {
        origenTransaccion: "NAC",
        codigoMonedaOrigen: "152",
        fechaTransaccionString: "02/11/2026",
        montoCompra: 4000,
        glosaTransaccion: "COMPRA CLP",
        despliegueCuotas: "01/01",
      },
    ],
  };

  const intlStatement = {
    existeEstadoCuenta: true,
    seccionPagos: {
      transaccionesTarjetas: [
        {
          fechaTransaccionString: "05/10/2026",
          descripcion: "PAGO",
          montoDolar: -10,
          grupo: "pagos",
        },
      ],
    },
    seccionCompras: {
      transaccionesTarjetas: [
        {
          fechaTransaccionString: "06/10/2026",
          descripcion: "COMPRA EXT",
          montoDolar: 25.5,
          grupo: "generico",
        },
        {
          fechaTransaccionString: "",
          descripcion: "TOTAL DE COMPRAS",
          montoDolar: 25.5,
          grupo: "TOTAL DE COMPRAS",
        },
      ],
    },
    seccionComisiones: { transaccionesTarjetas: null },
  };

  function fakeStatementPage(nationalStatement: unknown = { existeEstadoCuenta: false }) {
    return {
      evaluate: async (_fn: unknown, url: string) => {
        if (url.includes("informacion-tarjetas")) {
          return [
            { titular: true, marca: "M", tipo: "Black", idProducto: "id", numero: "****1111" },
          ];
        }
        if (url.includes("obtener-saldo")) throw new Error("sin saldo");
        if (url.includes("movimientos-no-facturados")) return intlUnbilled;
        if (url.includes("fechas-facturacion")) {
          return {
            existenEstadosDeCuenta: true,
            numeroCuenta: "123",
            listaNacional: [],
            listaInternacional: [{ fechaFacturacion: "2026-10-21" }],
          };
        }
        if (url.includes("internacional/resumen-por-fecha")) return intlStatement;
        if (url.includes("nacional/resumen-por-fecha")) return nationalStatement;
        throw new Error(`unexpected ${url}`);
      },
    } as unknown as Page;
  }

  it("informa la moneda de cada movimiento y lee el estado de cuenta internacional", async () => {
    const { movements } = await fetchCreditCardData(fakeStatementPage(), "Nombre", [] as never);

    const summary = movements.map((m) => [m.source, m.description, m.amount, m.currency ?? "CLP"]);
    expect(summary).toEqual([
      ["credit_card_unbilled", "COMPRA USD", -12.5, "USD"],
      ["credit_card_unbilled", "COMPRA CLP", -4000, "CLP"],
      ["credit_card_billed", "PAGO", 10, "USD"],
      ["credit_card_billed", "COMPRA EXT", -25.5, "USD"],
    ]);
  });
});

describe("fetchCreditCardData: estado de cuenta nacional con filas sin fecha", () => {
  const row = (descripcion: string, fecha: string | null, grupo = "avancesCompras") => ({
    fechaTransaccionString: fecha,
    montoTransaccion: 5000,
    descripcion,
    cuotas: "01/01",
    grupo,
  });

  function pageWithNationalStatement() {
    return {
      evaluate: async (_fn: unknown, url: string) => {
        if (url.includes("informacion-tarjetas")) {
          return [
            { titular: true, marca: "M", tipo: "Black", idProducto: "id", numero: "****1111" },
          ];
        }
        if (url.includes("obtener-saldo")) throw new Error("sin saldo");
        if (url.includes("movimientos-no-facturados")) {
          return { fechaProximaFacturacionCalendario: "15/12/2026", listaMovNoFactur: [] };
        }
        if (url.includes("fechas-facturacion")) {
          return {
            existenEstadosDeCuenta: true,
            numeroCuenta: "123",
            listaNacional: [{ fechaFacturacion: "2026-10-21" }],
            listaInternacional: [],
          };
        }
        if (url.includes("internacional/resumen-por-fecha")) return { existeEstadoCuenta: false };
        if (url.includes("nacional/resumen-por-fecha")) {
          return {
            existeEstadoCuenta: true,
            seccionOperaciones: {
              transaccionesTarjetas: [
                row("COMPRA UNO", "05/10/2026"),
                row("AVANCE SIN FECHA", null),
                row("COMPRA DOS", "07/10/2026"),
                row("TOTAL TARJETA XXXXXXXXXXXX1111", "07/10/2026", "generico"),
              ],
            },
            seccionCargosImpuestosAbonos: {
              transaccionesTarjetas: [row("COMISION", "08/10/2026", "generico")],
            },
          };
        }
        throw new Error(`unexpected ${url}`);
      },
    } as unknown as Page;
  }

  it("conserva todas las filas: la que no trae fecha usa la fecha de facturación y no corta el resto", async () => {
    const debug: string[] = [];
    const { movements } = await fetchCreditCardData(
      pageWithNationalStatement(),
      "N",
      debug as never
    );

    expect(movements.map((m) => [m.description, m.date])).toEqual([
      ["COMPRA UNO", "05-10-2026"],
      ["AVANCE SIN FECHA", "21-10-2026"],
      ["COMPRA DOS", "07-10-2026"],
      ["COMISION", "08-10-2026"],
    ]);
    expect(debug.join("\n")).toContain("movimiento sin fecha");
    expect(debug.join("\n")).not.toContain("error leyendo estados de cuenta");
  });
});
