import { describe, it } from "vitest";
import { expectMovementContract } from "../../testing/movement-contract.js";
import {
  normalizeSantanderBilledApiMovements,
  normalizeSantanderCheckingApiMovements,
  normalizeSantanderUnbilledApiMovements,
} from "./parse.js";

describe("contrato de BankMovement (santander)", () => {
  it("API cuenta emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeSantanderCheckingApiMovements([
        {
          movements: [
            {
              transactionDate: "2026-01-15",
              movementAmount: "00000300000",
              chargePaymentFlag: "D",
              observation: "Supermercado Lider",
              expandedCode: "",
            },
            {
              transactionDate: "2026-02-10",
              movementAmount: "00000500000",
              chargePaymentFlag: "H",
              observation: "Depósito sueldo",
              expandedCode: "",
            },
          ],
        },
      ])
    );
  });
  it("TC no facturada emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeSantanderUnbilledApiMovements([
        {
          DATA: {
            MatrizMovimientos: [
              {
                Fecha: "15/01/2026",
                Comercio: "Netflix",
                Descripcion: "",
                Importe: "15.990",
                IndicadorDebeHaber: "D",
              },
            ],
          },
        },
      ])
    );
  });
  it("TC facturada, con cuotas emite movimientos que cumplen el contrato", () => {
    expectMovementContract(
      normalizeSantanderBilledApiMovements([
        {
          DATA: {
            AS_TIB_WM02_CONEstCtaNacional_Response: {
              OUTPUT: {
                Matriz: [
                  {
                    FechaTxs: "2026-01-10",
                    NombreComercio: "Notebook",
                    MontoTxs: "0000100000",
                    NumeroCuotas: "01",
                    TotalCuotas: "06",
                  },
                  {
                    FechaTxs: "2026-01-25",
                    NombreComercio: "Monto Cancelado",
                    MontoTxs: "0000200000",
                    NumeroCuotas: "00",
                    TotalCuotas: "00",
                  },
                ],
              },
            },
          },
        },
      ])
    );
  });
});
