import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeDate, parseChileanAmount } from "../../core/parsing.js";

/** Fila cruda tal como la entrega el DOM (fechas y montos sin normalizar). */
export interface RawScotiabankMovement {
  date: string;
  description: string;
  amount: string;
  balance: string;
}

/**
 * Convierte las filas crudas del DOM en movimientos: normaliza fecha y montos, descarta
 * los de monto 0 y los duplicados exactos (fecha + descripción + monto).
 */
export function normalizeScotiabankMovements(allRaw: RawScotiabankMovement[]): BankMovement[] {
  const seen = new Set<string>();
  return allRaw
    .map((m): BankMovement | null => {
      const amount = parseChileanAmount(m.amount);
      if (amount === 0) return null;
      return {
        date: normalizeDate(m.date),
        description: m.description,
        amount,
        balance: m.balance ? parseChileanAmount(m.balance) : 0,
        source: MOVEMENT_SOURCE.account,
      };
    })
    .filter((m): m is BankMovement => {
      if (!m) return false;
      const key = `${m.date}|${m.description}|${m.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Extrae el saldo desde el texto visible de la página ("saldo disponible" o "saldo actual"). */
export function parseBalanceText(bodyText: string): number | undefined {
  const patterns = [
    /saldo disponible[\s\S]{0,50}\$\s*([\d.]+)/i,
    /saldo actual[\s\S]{0,50}\$\s*([\d.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match) return parseInt(match[1].replace(/[^0-9]/g, ""), 10);
  }
  return undefined;
}
