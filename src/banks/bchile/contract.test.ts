import { describe, it } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { expectMovementContract } from "../../testing/movement-contract.js";
import { cartolaMovToMovement, facturadoToMovement } from "./parse.js";

describe("contrato de BankMovement (bchile)", () => {
  it("la cartola de cuenta emite movimientos que cumplen el contrato", () => {
    expectMovementContract([
      cartolaMovToMovement({
        descripcion: "Pago proveedor",
        monto: 15990,
        saldo: 100000,
        tipo: "cargo",
        fechaContable: "02-10-2026",
      }),
      cartolaMovToMovement({
        descripcion: "Sueldo",
        monto: 500000,
        saldo: 600000,
        tipo: "abono",
        fechaContable: "01-10-2026",
      }),
    ]);
  });

  it("los movimientos facturados de TC cumplen el contrato", () => {
    expectMovementContract([
      facturadoToMovement(
        {
          fechaTransaccionString: "2026-09-15",
          montoTransaccion: 25990,
          descripcion: "Compra en cuotas",
          cuotas: "3/6",
          grupo: "compras",
        },
        MOVEMENT_SOURCE.credit_card_billed,
        "****1234"
      ),
      facturadoToMovement(
        {
          fechaTransaccionString: "2026-09-20",
          montoTransaccion: 50000,
          descripcion: "Pago a la cuenta",
          cuotas: "0/0",
          grupo: "pagos",
        },
        MOVEMENT_SOURCE.credit_card_billed,
        "****1234"
      ),
    ]);
  });
});
