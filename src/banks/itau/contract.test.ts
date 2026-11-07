import { describe, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { normalizeItauBilledRows, normalizeItauCreditCardRows } from "./parse.js";

describe("contrato de BankMovement (itau)", () => {
  it("TC facturada emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeItauBilledRows([
        {
          date: "17/03/2026",
          desc: "Ebpay eparis tasa int. 2,76%",
          total: "$ 802.230",
          cuota: "06/10",
          valorCuota: "$ 80.223",
        },
      ])
    );
  });
  it("TC no facturada, CLP y USD emite movimientos que cumplen el contrato", () => {
    expectMovementContract([
      ...normalizeItauCreditCardRows(
        [
          {
            date: "09/10/2026",
            desc: "MERPAGOMERCADOPAGO 00-12 CUOTA",
            amount: "$ 799.980",
            isCredit: false,
            installments: "00/12",
          },
        ],
        { source: MOVEMENT_SOURCE.credit_card_unbilled }
      ),
      ...normalizeItauCreditCardRows(
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
      ),
    ]);
  });
});
