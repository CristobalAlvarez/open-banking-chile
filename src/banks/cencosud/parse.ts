import type { BankMovement, MovementSource } from "../../core/types.js";
import { normalizeDate, normalizeInstallments } from "../../core/parsing.js";

/** Fila cruda tal como la entrega `page.evaluate` en `extractOnePage`. */
interface RawCencosudMovement {
  date: string;
  description: string;
  amount: number;
  installments?: string;
  source: string;
}

/** Normaliza las filas crudas de la tabla de movimientos a `BankMovement`. */
export function parseCencosudMovements(
  raw: RawCencosudMovement[],
  source: MovementSource
): BankMovement[] {
  return raw.map((m): BankMovement => {
    const inst = normalizeInstallments(m.installments);
    return {
      ...m,
      date: normalizeDate(m.date),
      balance: 0,
      source: source,
      ...(inst ? { installments: inst } : {}),
    };
  });
}
