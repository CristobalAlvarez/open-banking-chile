import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  normalizeItauBilledRows,
  normalizeItauCreditCardRows,
  parseCreditCardSummary,
} from "./parse.js";

// ─── normalizeItauBilledRows ─────────────────────────────────────

describe("normalizeItauBilledRows", () => {
  it("uses the period charge (Valor cuota) as amount, not the operation total", () => {
    const [m] = normalizeItauBilledRows([
      {
        date: "17/03/2026",
        desc: "Ebpay eparis tasa int. 2,76%",
        total: "$ 802.230",
        cuota: "06/10",
        valorCuota: "$ 80.223",
      },
    ]);
    expect(m.amount).toBe(-80223);
    expect(m.totalAmount).toBe(802230);
    expect(m.installments).toBe("06/10");
    expect(m.date).toBe("17-03-2026");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_billed);
  });

  it("omits totalAmount when it equals the period charge", () => {
    const [m] = normalizeItauBilledRows([
      {
        date: "01/09/2026",
        desc: "Bupa seguros santiago",
        total: "$ 63.111",
        cuota: "01/1",
        valorCuota: "$ 63.111",
      },
    ]);
    expect(m.amount).toBe(-63111);
    expect(m.totalAmount).toBeUndefined();
    expect(m.installments).toBe("01/01");
  });

  it("keeps payments and credits positive", () => {
    const [m] = normalizeItauBilledRows([
      {
        date: "26/08/2026",
        desc: "Monto cancelado",
        total: "$ -1.874.377",
        cuota: "01/1",
        valorCuota: "$ -1.874.377",
      },
    ]);
    expect(m.amount).toBe(1874377);
  });

  it("omits installments when the cuota cell is empty", () => {
    const [m] = normalizeItauBilledRows([
      {
        date: "01/09/2026",
        desc: "Comision administracion mensual",
        total: "$ 24.600",
        cuota: "",
        valorCuota: "$ 24.600",
      },
    ]);
    expect(m.installments).toBeUndefined();
  });

  it("skips rows without an amount", () => {
    expect(
      normalizeItauBilledRows([
        { date: "01/09/2026", desc: "sin monto", total: "", cuota: "01/1", valorCuota: "$ 0" },
      ])
    ).toEqual([]);
  });
});

// ─── normalizeItauCreditCardRows ─────────────────────────────────

describe("normalizeItauCreditCardRows", () => {
  const unbilled = { source: MOVEMENT_SOURCE.credit_card_unbilled } as const;

  it("keeps pending installment purchases (00/N) as charges with installments", () => {
    const [m] = normalizeItauCreditCardRows(
      [
        {
          date: "09/10/2026",
          desc: "MERPAGOMERCADOPAGO 00-12 CUOTA",
          amount: "$ 799.980",
          isCredit: false,
          installments: "00/12",
        },
      ],
      unbilled
    );
    expect(m.amount).toBe(-799980);
    expect(m.installments).toBe("00/12");
    expect(m.date).toBe("09-10-2026");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_unbilled);
  });

  it("maps credits to positive amounts", () => {
    const [m] = normalizeItauCreditCardRows(
      [
        {
          date: "16/10/2026",
          desc: "Abono canje compra tc",
          amount: "$ 5.405",
          isCredit: true,
          installments: "",
        },
      ],
      unbilled
    );
    expect(m.amount).toBe(5405);
  });

  it("treats negative amounts as credits even without the abono class", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "26/08/2026", desc: "Monto Cancelado 6010", amount: "-44,77", isCredit: false }],
      { source: MOVEMENT_SOURCE.credit_card_billed, currency: "USD" }
    );
    expect(m.amount).toBe(44.77);
    expect(m.currency).toBe("USD");
  });

  it("keeps USD amounts with decimals and sets currency for international rows", () => {
    const [m] = normalizeItauCreditCardRows(
      [
        {
          date: "17/10/2026",
          desc: "PLAYSTATION COMPRAS INTMA",
          amount: "USD 47,61",
          isCredit: false,
          installments: "",
        },
      ],
      { source: MOVEMENT_SOURCE.credit_card_unbilled, currency: "USD" }
    );
    expect(m.amount).toBe(-47.61);
    expect(m.currency).toBe("USD");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_unbilled);
  });

  it("does not set currency for CLP rows", () => {
    const [m] = normalizeItauCreditCardRows(
      [
        {
          date: "05/10/2026",
          desc: "MP BELENUS",
          amount: "$ 27.990",
          isCredit: false,
          installments: "1/1",
        },
      ],
      unbilled
    );
    expect(m.currency).toBeUndefined();
  });

  it("normalizes single-payment cuotas notation", () => {
    const [m] = normalizeItauCreditCardRows(
      [
        {
          date: "05/10/2026",
          desc: "MP BELENUS",
          amount: "$ 27.990",
          isCredit: false,
          installments: "1/1",
        },
      ],
      unbilled
    );
    expect(m.installments).toBe("01/01");
  });

  it("skips rows without an amount", () => {
    expect(
      normalizeItauCreditCardRows(
        [{ date: "05/10/2026", desc: "sin monto", amount: "", isCredit: false, installments: "" }],
        unbilled
      )
    ).toEqual([]);
  });
});

// ─── parseCreditCardSummary ──────────────────────────────────────

// Texto de la página de deuda con el orden real del portal: en cada sección, "Cupo disponible
// <valor>", luego las etiquetas "Cupo utilizado" y "Cupo total", y después sus dos valores.
const nationalBlock = [
  "Nacional",
  "Ir a estado de cuenta",
  "Cupo disponible $ 600.000",
  "Cupo utilizado",
  "Cupo total",
  "$ 4.400.000",
  "$ 5.000.000",
  "Monto facturado",
  "$ 1.900.000",
  "Monto mínimo",
  "$ 0",
];

const internationalBlock = (disponible: string, utilizado: string, total: string) => [
  "Internacional",
  "Ir a estado de cuenta",
  `Cupo disponible USD ${disponible}`,
  "Cupo utilizado",
  "Cupo total",
  `USD ${utilizado}`,
  `USD ${total}`,
  "Monto facturado",
  "USD 34,36",
];

const debtPageText = (...blocks: string[][]) =>
  [
    "Mastercard Legend",
    "**** **** **** 1234",
    "Próxima facturación 25/11/2026",
    ...blocks.flat(),
    "Ofertas",
  ].join("\n");

describe("parseCreditCardSummary", () => {
  it("no cruza disponible, utilizado y total del cupo internacional (USD) cuando hay uso", () => {
    const card = parseCreditCardSummary(
      debtPageText(nationalBlock, internationalBlock("5.752,39", "47,61", "5.800"))
    );

    expect(card?.international).toEqual({
      used: 47.61,
      available: 5752.39,
      total: 5800,
      currency: "USD",
    });
  });

  it("mantiene el cupo internacional sin uso: utilizado 0 no es un valor ausente", () => {
    const card = parseCreditCardSummary(
      debtPageText(nationalBlock, internationalBlock("5.800", "0", "5.800"))
    );

    expect(card?.international).toEqual({
      used: 0,
      available: 5800,
      total: 5800,
      currency: "USD",
    });
  });

  it("lee el cupo nacional en pesos y su total es utilizado + disponible", () => {
    const card = parseCreditCardSummary(
      debtPageText(nationalBlock, internationalBlock("5.800", "0", "5.800"))
    );

    expect(card?.national).toEqual({ used: 4400000, available: 600000, total: 5000000 });
  });

  it("normaliza la etiqueta de la tarjeta y la fecha de próxima facturación", () => {
    const card = parseCreditCardSummary(debtPageText(nationalBlock));

    expect(card?.label).toBe("Mastercard Legend ****1234");
    expect(card?.nextBillingDate).toBe("25-11-2026");
  });

  it("no informa cupo internacional cuando la tarjeta no tiene esa sección", () => {
    const card = parseCreditCardSummary(debtPageText(nationalBlock));

    expect(card?.international).toBeUndefined();
  });

  it("devuelve undefined cuando la página no trae una tarjeta", () => {
    expect(parseCreditCardSummary("Sin productos contratados")).toBeUndefined();
  });
});
