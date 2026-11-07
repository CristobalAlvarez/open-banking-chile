import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  cartolaMovToMovement,
  cartolaTotal,
  chileanDateKey,
  facturadoToMovement,
  hasMoreCartola,
  parseCartolaFlag,
  selectStatementDates,
} from "./parse.js";

describe("parseCartolaFlag", () => {
  it("interpreta S/N como booleanos (no por truthiness)", () => {
    expect(parseCartolaFlag("S")).toBe(true);
    expect(parseCartolaFlag("s")).toBe(true);
    expect(parseCartolaFlag("N")).toBe(false);
    expect(parseCartolaFlag("n")).toBe(false);
  });

  it("acepta booleanos, números y valores ausentes", () => {
    expect(parseCartolaFlag(true)).toBe(true);
    expect(parseCartolaFlag(false)).toBe(false);
    expect(parseCartolaFlag(1)).toBe(true);
    expect(parseCartolaFlag(0)).toBe(false);
    expect(parseCartolaFlag(undefined)).toBe(false);
    expect(parseCartolaFlag("")).toBe(false);
  });
});

describe("cartolaTotal", () => {
  it("parsea números y strings con separadores", () => {
    expect(cartolaTotal({ totalRegistros: 73 })).toBe(73);
    expect(cartolaTotal({ totalRegistros: "1.234" })).toBe(1234);
  });

  it("devuelve undefined si no hay total utilizable", () => {
    expect(cartolaTotal(undefined)).toBeUndefined();
    expect(cartolaTotal({ totalRegistros: "" })).toBeUndefined();
    expect(cartolaTotal({ totalRegistros: "0" })).toBeUndefined();
  });
});

describe("hasMoreCartola", () => {
  it("sigue mientras falten registros aunque masPaginas diga N", () => {
    expect(hasMoreCartola({ totalRegistros: "250", masPaginas: "N" }, 100)).toBe(true);
  });

  it("para cuando ya están todos y masPaginas es N", () => {
    expect(hasMoreCartola({ totalRegistros: "73", masPaginas: "N" }, 73)).toBe(false);
  });

  it("sigue si masPaginas dice S aunque el total ya se alcanzó", () => {
    expect(hasMoreCartola({ totalRegistros: "73", masPaginas: "S" }, 73)).toBe(true);
  });

  it("no pagina sin movimientos ni sin metadata", () => {
    expect(hasMoreCartola({ totalRegistros: "250", masPaginas: "S" }, 0)).toBe(false);
    expect(hasMoreCartola(undefined, 10)).toBe(false);
  });
});

describe("selectStatementDates", () => {
  it("devuelve las dos más nuevas, sin duplicados", () => {
    const fechas = {
      listaNacional: [
        { fechaFacturacion: "2026-10-05" },
        { fechaFacturacion: "2026-09-05" },
        { fechaFacturacion: "2026-08-05" },
      ],
      listaInternacional: [{ fechaFacturacion: "2026-10-05" }, { fechaFacturacion: "2026-09-05" }],
    };
    expect(selectStatementDates(fechas)).toEqual(["2026-10-05", "2026-09-05"]);
  });

  it("ordena newest-first aunque la API las mezcle", () => {
    const fechas = {
      listaNacional: [{ fechaFacturacion: "2026-08-05" }, { fechaFacturacion: "2026-10-05" }],
    };
    expect(selectStatementDates(fechas)).toEqual(["2026-10-05", "2026-08-05"]);
  });

  it("ignora fechas inválidas y listas ausentes", () => {
    expect(selectStatementDates(undefined)).toEqual([]);
    expect(
      selectStatementDates({
        listaNacional: [{ fechaFacturacion: "05/10/2026" }, { fechaFacturacion: "2026-10-05" }],
      })
    ).toEqual(["2026-10-05"]);
  });

  it("respeta el límite pedido", () => {
    const fechas = {
      listaNacional: [{ fechaFacturacion: "2026-10-05" }, { fechaFacturacion: "2026-09-05" }],
    };
    expect(selectStatementDates(fechas, 1)).toEqual(["2026-10-05"]);
  });
});

describe("chileanDateKey", () => {
  const keyOf = (value: string): number => {
    const key = chileanDateKey(value);
    if (key === undefined) throw new Error(`fecha inválida: ${value}`);
    return key;
  };

  it("convierte dd-mm-yyyy en una clave ordenable", () => {
    expect(keyOf("02-10-2026")).toBe(20261002);
    expect(keyOf("02-10-2026")).toBeLessThan(keyOf("03-10-2026"));
  });

  it("devuelve undefined para fechas fuera del formato del scraper", () => {
    expect(chileanDateKey(undefined)).toBeUndefined();
    expect(chileanDateKey("2026-10-02")).toBeUndefined();
  });
});

describe("cartolaMovToMovement", () => {
  it("marca los cargos en negativo y los abonos en positivo", () => {
    expect(
      cartolaMovToMovement({
        descripcion: "  Pago proveedor  ",
        monto: 15990,
        saldo: 100000,
        tipo: "cargo",
        fechaContable: "02-10-2026",
      })
    ).toEqual({
      date: "02-10-2026",
      description: "Pago proveedor",
      amount: -15990,
      balance: 100000,
      source: MOVEMENT_SOURCE.account,
    });
    expect(
      cartolaMovToMovement({
        descripcion: "Sueldo",
        monto: -500000,
        saldo: 600000,
        tipo: "abono",
        fechaContable: "01-10-2026",
      }).amount
    ).toBe(500000);
  });
});

describe("facturadoToMovement", () => {
  it("deja los pagos en positivo y las compras en negativo", () => {
    const pago = facturadoToMovement(
      {
        fechaTransaccionString: "2026-09-15",
        montoTransaccion: 25990,
        descripcion: "  Pago mínimo ",
        cuotas: "0/0",
        grupo: "pagos",
      },
      MOVEMENT_SOURCE.credit_card_billed,
      "****1234"
    );
    expect(pago).toEqual({
      date: "15-09-2026",
      description: "Pago mínimo",
      amount: 25990,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_billed,
      card: "****1234",
      installments: "00/00",
    });
    expect(
      facturadoToMovement(
        {
          fechaTransaccionString: "2026-09-16",
          montoTransaccion: -12000,
          descripcion: "Compra",
          cuotas: "3/6",
          grupo: "compras",
        },
        MOVEMENT_SOURCE.credit_card_billed
      ).amount
    ).toBe(-12000);
  });

  it("normaliza las cuotas a NN/NN y deja la tarjeta opcional", () => {
    const mov = facturadoToMovement(
      {
        fechaTransaccionString: "2026-09-16",
        montoTransaccion: 12000,
        descripcion: "Compra",
        cuotas: "3/6",
        grupo: "compras",
      },
      MOVEMENT_SOURCE.credit_card_billed
    );
    expect(mov.installments).toBe("03/06");
    expect(mov.card).toBeUndefined();
  });
});
