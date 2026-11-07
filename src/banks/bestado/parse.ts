import { normalizeDate, parseChileanAmount } from "../../core/parsing.js";
import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";

/** Fila cruda tal como sale del DOM de BancoEstado, antes de normalizar. */
export interface RawMovement {
  date: string;
  description: string;
  amount: string;
  balance: string;
}

/** Normaliza las filas crudas a `BankMovement`; descarta las filas sin monto. */
export function parseRawMovements(raw: RawMovement[]): BankMovement[] {
  return raw
    .map((r): BankMovement | null => {
      const amount = parseChileanAmount(r.amount);
      if (amount === 0) return null;
      return {
        date: normalizeDate(r.date),
        description: r.description,
        amount,
        balance: r.balance ? parseChileanAmount(r.balance) : 0,
        source: MOVEMENT_SOURCE.account,
      };
    })
    .filter((m): m is BankMovement => m !== null);
}
