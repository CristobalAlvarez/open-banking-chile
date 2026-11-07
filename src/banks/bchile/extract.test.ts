import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { fetchAccountMovements } from "./extract.js";

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
