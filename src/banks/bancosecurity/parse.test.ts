import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { parseTxtMovements } from "./parse.js";

/**
 * Línea sintética con el formato fijo del TXT de cartola histórica:
 * "2" + fecha (10) + descripción (50) + documento (9) + tipo (1) + "+" + montos.
 */
function txtLine(
  date: string,
  description: string,
  type: "C" | "A",
  amount: string,
  balance: string
): string {
  return `2${date.padEnd(10)}${description.padEnd(50)}000000001${type}+${amount.padStart(12)}${balance.padStart(18)}`;
}

describe("parseTxtMovements", () => {
  it("parsea cargos (C) como negativos y abonos (A) como positivos", () => {
    const movements = parseTxtMovements(
      [
        txtLine("15/01/2026", "COMPRA SUPERMERCADO EJEMPLO", "C", "15.990", "1.234.010"),
        txtLine("16/01/2026", "TRANSFERENCIA RECIBIDA DE TERCERO", "A", "500.000", "1.734.010"),
      ].join("\n")
    );

    expect(movements).toEqual([
      {
        date: "15-01-2026",
        description: "COMPRA SUPERMERCADO EJEMPLO",
        amount: -15990,
        balance: 1234010,
        source: MOVEMENT_SOURCE.account,
      },
      {
        date: "16-01-2026",
        description: "TRANSFERENCIA RECIBIDA DE TERCERO",
        amount: 500000,
        balance: 1734010,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("fuerza el signo según el tipo aunque el monto venga con signo", () => {
    const movements = parseTxtMovements(
      [
        txtLine("20/01/2026", "CARGO CON SIGNO EXPLICITO", "C", "-5.000", "1.229.010"),
        txtLine("21/01/2026", "ABONO CON SIGNO EXPLICITO", "A", "-7.000", "1.236.010"),
      ].join("\n")
    );

    expect(movements.map((m) => m.amount)).toEqual([-5000, 7000]);
  });

  it("deja el saldo en 0 cuando la línea no lo trae", () => {
    const movements = parseTxtMovements(txtLine("18/01/2026", "CARGO SIN SALDO", "C", "2.000", ""));

    expect(movements).toEqual([
      {
        date: "18-01-2026",
        description: "CARGO SIN SALDO",
        amount: -2000,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      },
    ]);
  });

  it("ignora líneas que no son movimientos, fechas inválidas y montos en cero", () => {
    const movements = parseTxtMovements(
      [
        "CABECERA DEL ARCHIVO",
        "2CABECERA QUE EMPIEZA CON DOS",
        txtLine("SIN FECHA", "LINEA SIN FECHA VALIDA", "C", "1.000", "1.733.010"),
        txtLine("17/01/2026", "MOVIMIENTO EN CERO", "C", "0", "1.733.010"),
        txtLine("19/01/2026", "MOVIMIENTO VALIDO", "C", "1.000", "1.732.010"),
      ].join("\r\n")
    );

    expect(movements).toHaveLength(1);
    expect(movements[0].description).toBe("MOVIMIENTO VALIDO");
  });

  it("devuelve [] para un texto vacío", () => {
    expect(parseTxtMovements("")).toEqual([]);
  });
});
