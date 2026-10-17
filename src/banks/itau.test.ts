import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../types.js";
import { normalizeItauBilledRows, normalizeItauCreditCardRows } from "./itau.js";

// ─── normalizeItauBilledRows ─────────────────────────────────────

describe("normalizeItauBilledRows", () => {
  it("uses the period charge (Valor cuota) as amount, not the operation total", () => {
    const [m] = normalizeItauBilledRows([
      { date: "17/03/2026", desc: "Ebpay eparis tasa int. 2,76%", total: "$ 802.230", cuota: "06/10", valorCuota: "$ 80.223" },
    ]);
    expect(m.amount).toBe(-80223);
    expect(m.totalAmount).toBe(802230);
    expect(m.installments).toBe("06/10");
    expect(m.date).toBe("17-03-2026");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_billed);
  });

  it("omits totalAmount when it equals the period charge", () => {
    const [m] = normalizeItauBilledRows([
      { date: "01/09/2026", desc: "Bupa seguros santiago", total: "$ 63.111", cuota: "01/1", valorCuota: "$ 63.111" },
    ]);
    expect(m.amount).toBe(-63111);
    expect(m.totalAmount).toBeUndefined();
    expect(m.installments).toBe("01/01");
  });

  it("keeps payments and credits positive", () => {
    const [m] = normalizeItauBilledRows([
      { date: "26/08/2026", desc: "Monto cancelado", total: "$ -1.874.377", cuota: "01/1", valorCuota: "$ -1.874.377" },
    ]);
    expect(m.amount).toBe(1874377);
  });

  it("omits installments when the cuota cell is empty", () => {
    const [m] = normalizeItauBilledRows([
      { date: "01/09/2026", desc: "Comision administracion mensual", total: "$ 24.600", cuota: "", valorCuota: "$ 24.600" },
    ]);
    expect(m.installments).toBeUndefined();
  });

  it("skips rows without an amount", () => {
    expect(
      normalizeItauBilledRows([
        { date: "01/09/2026", desc: "sin monto", total: "", cuota: "01/1", valorCuota: "$ 0" },
      ]),
    ).toEqual([]);
  });
});

// ─── normalizeItauCreditCardRows ─────────────────────────────────

describe("normalizeItauCreditCardRows", () => {
  const unbilled = { source: MOVEMENT_SOURCE.credit_card_unbilled } as const;

  it("keeps pending installment purchases (00/N) as charges with installments", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "09/10/2026", desc: "MERPAGOMERCADOPAGO 00-12 CUOTA", amount: "$ 799.980", isCredit: false, installments: "00/12" }],
      unbilled,
    );
    expect(m.amount).toBe(-799980);
    expect(m.installments).toBe("00/12");
    expect(m.date).toBe("09-10-2026");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_unbilled);
  });

  it("maps credits to positive amounts", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "16/10/2026", desc: "Abono canje compra tc", amount: "$ 5.405", isCredit: true, installments: "" }],
      unbilled,
    );
    expect(m.amount).toBe(5405);
  });

  it("treats negative amounts as credits even without the abono class", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "26/08/2026", desc: "Monto Cancelado 6010", amount: "-44,77", isCredit: false }],
      { source: MOVEMENT_SOURCE.credit_card_billed, currency: "USD" },
    );
    expect(m.amount).toBe(44.77);
    expect(m.currency).toBe("USD");
  });

  it("keeps USD amounts with decimals and sets currency for international rows", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "17/10/2026", desc: "PLAYSTATION COMPRAS INTMA", amount: "USD 47,61", isCredit: false, installments: "" }],
      { source: MOVEMENT_SOURCE.credit_card_unbilled, currency: "USD" },
    );
    expect(m.amount).toBe(-47.61);
    expect(m.currency).toBe("USD");
    expect(m.source).toBe(MOVEMENT_SOURCE.credit_card_unbilled);
  });

  it("does not set currency for CLP rows", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "05/10/2026", desc: "MP BELENUS", amount: "$ 27.990", isCredit: false, installments: "1/1" }],
      unbilled,
    );
    expect(m.currency).toBeUndefined();
  });

  it("normalizes single-payment cuotas notation", () => {
    const [m] = normalizeItauCreditCardRows(
      [{ date: "05/10/2026", desc: "MP BELENUS", amount: "$ 27.990", isCredit: false, installments: "1/1" }],
      unbilled,
    );
    expect(m.installments).toBe("01/01");
  });

  it("skips rows without an amount", () => {
    expect(
      normalizeItauCreditCardRows([{ date: "05/10/2026", desc: "sin monto", amount: "", isCredit: false, installments: "" }], unbilled),
    ).toEqual([]);
  });
});
