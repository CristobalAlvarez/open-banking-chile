import type { BankMovement, MovementSource } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  parseChileanAmount,
  parseUsdAmount,
  normalizeDate,
  normalizeInstallments,
} from "../../core/parsing.js";

export interface ItauCreditCardRow {
  date: string;
  desc: string;
  amount: string;
  isCredit: boolean;
  installments?: string;
}

/**
 * Convierte filas simples de TC a movimientos: no facturados nacionales (CLP)
 * e internacionales (USD), y facturados internacionales (USD).
 *
 * El signo sale del monto (negativo = abono) o de la clase de la celda
 * (`cargos`/`abono`). `currency` solo se agrega cuando no es CLP.
 */
export function normalizeItauCreditCardRows(
  rows: ItauCreditCardRow[],
  opts: { source: MovementSource; currency?: "CLP" | "USD" }
): BankMovement[] {
  const currency = opts.currency ?? "CLP";
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const parsed = currency === "USD" ? parseUsdAmount(m.amount) : parseChileanAmount(m.amount);
    if (parsed === 0) continue;
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount: parsed < 0 || m.isCredit ? Math.abs(parsed) : -Math.abs(parsed),
      balance: 0,
      source: opts.source,
      installments: normalizeInstallments(m.installments),
      ...(currency === "USD" ? { currency: "USD" as const } : {}),
    });
  }
  return movements;
}

export interface ItauBilledRow {
  date: string;
  desc: string;
  total: string;
  cuota: string;
  valorCuota: string;
}

/**
 * Convierte filas crudas del estado de cuenta (cuenta nacional) a movimientos.
 *
 * "Valor cuota" es lo que se carga al período; para compras en cuotas es menor
 * que "Monto Operación", que es el total de la operación. Ese total va en
 * totalAmount ("Monto total a pagar") cuando difiere del cargo del período.
 */
export function normalizeItauBilledRows(rows: ItauBilledRow[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const charged = parseChileanAmount(m.valorCuota);
    if (charged === 0) continue;
    const amount = charged > 0 ? -charged : Math.abs(charged);
    const total = parseChileanAmount(m.total);
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_billed,
      installments: normalizeInstallments(m.cuota),
      ...(Math.abs(total) !== Math.abs(charged) ? { totalAmount: Math.abs(total) } : {}),
    });
  }
  return movements;
}
