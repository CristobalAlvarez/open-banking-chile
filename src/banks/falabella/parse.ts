import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeDate, normalizeInstallments, normalizeOwner } from "../../core/parsing.js";

/** Fila cruda de la tabla de la cartola, tal como la devuelve `page.evaluate`. */
export interface AccountMovementRow {
  date: string;
  description: string;
  amount: number;
  balance: number;
}

/**
 * Descarta filas sin monto (un movimiento de $0 no existe) y normaliza la fecha a dd-mm-yyyy.
 */
export function parseAccountRows(raw: AccountMovementRow[]): BankMovement[] {
  return raw
    .filter((m) => m.amount !== 0)
    .map((m): BankMovement => ({
      date: normalizeDate(m.date),
      description: m.description,
      amount: m.amount,
      balance: m.balance,
      source: MOVEMENT_SOURCE.account,
    }));
}

/** Fila cruda de la página CMR: `owner` llega como texto antes de normalizarse. */
export type CmrMovementRow = Omit<BankMovement, "owner"> & { owner?: string };

/** Normaliza fecha, titular y cuotas de una página de movimientos CMR. */
export function parseCmrRows(rows: CmrMovementRow[]): BankMovement[] {
  return rows.map((m): BankMovement => ({
    ...m,
    date: normalizeDate(m.date),
    owner: normalizeOwner(m.owner),
    installments: normalizeInstallments(m.installments),
  }));
}

/** Extrae el saldo disponible del texto de la página; `undefined` si no aparece. */
export function parseAvailableBalance(bodyText: string | null | undefined): number | undefined {
  const match = bodyText?.match(/Saldo disponible[\s\S]{0,50}\$\s*([\d.]+)/i);
  if (!match) return undefined;
  return parseInt(match[1].replace(/[^0-9]/g, ""), 10);
}

/** Máscara de la tarjeta (ej: "****1234") presente en la etiqueta CMR. */
export function extractCardMask(label: string): string | undefined {
  return label.match(/\*{4}\d{4}/)?.[0];
}

/** Etiqueta los movimientos con la máscara de la tarjeta cuando existe. */
export function tagCardMovements(movements: BankMovement[], cardMask?: string): BankMovement[] {
  return cardMask
    ? movements.map((m): BankMovement => ({
        ...m,
        card: cardMask,
      }))
    : movements;
}
