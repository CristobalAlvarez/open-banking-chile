import type { BankMovement, CreditCardBalance, MovementSource } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeDate, normalizeInstallments, parseChileanAmount } from "../../core/parsing.js";

/** Fila cruda de la tabla de movimientos de cuenta (mes actual o periodo histórico). */
export interface AccountMovementRow {
  date: string;
  category: string;
  description: string;
  amount: string;
}

/** Fila cruda de `app-transaction-row` en la página de tarjeta de crédito. */
export interface TcMovementRow {
  date: string;
  description: string;
  amount: string;
  installments: string;
}

/** Datos crudos de cupos, etiqueta y fechas de la tarjeta de crédito. */
export interface RawCreditCardInfo {
  label?: string;
  nationalUsed?: number;
  nationalAvailable?: number;
  nationalTotal?: number;
  internationalUsed?: number;
  internationalAvailable?: number;
  internationalTotal?: number;
  billingPeriod?: string;
  nextBillingDate?: string;
}

/** Convierte las filas de la tabla del mes actual a movimientos de cuenta. */
export function parseCurrentMonthMovements(raw: AccountMovementRow[]): BankMovement[] {
  return raw
    .map((r): BankMovement | null => {
      const amountVal = parseChileanAmount(r.amount);
      if (amountVal === 0) return null;
      const amount = r.category.includes("cargo") ? -amountVal : amountVal;
      return {
        date: normalizeDate(r.date),
        description: r.description,
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      };
    })
    .filter((m): m is BankMovement => m !== null);
}

/** Convierte las filas de la tabla de cartolas históricas a movimientos de cuenta. */
export function parseHistoricalMovements(raw: AccountMovementRow[]): BankMovement[] {
  return raw
    .map((r): BankMovement | null => {
      const amountVal = parseChileanAmount(r.amount);
      if (amountVal === 0) return null;
      const amount = r.category.includes("cargo") ? -amountVal : amountVal;
      return {
        date: normalizeDate(r.date),
        description: r.description,
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      };
    })
    .filter((m): m is BankMovement => m !== null);
}

/** Convierte las filas de tarjeta de crédito a movimientos (cargos negativos, abonos positivos). */
export function parseTcMovements(raw: TcMovementRow[], source: MovementSource): BankMovement[] {
  return raw
    .map((r): BankMovement | null => {
      const amountVal = parseChileanAmount(r.amount);
      if (amountVal === 0) return null;
      // TC movements are always expenses (negative)
      // Exception: abonos/payments which are credits
      const descLower = r.description.toLowerCase();
      const isCredit =
        descLower.includes("abono") ||
        /\bpago\b/.test(descLower) ||
        descLower.includes("nota de credito") ||
        descLower.includes("nota de crédito") ||
        descLower.includes("reverso") ||
        descLower.includes("anulacion") ||
        descLower.includes("anulación");
      const amount = isCredit ? amountVal : -amountVal;

      return {
        date: normalizeDate(r.date),
        description: r.description,
        amount,
        balance: 0,
        source,
        // "1 de 1" = pago único: no se informa como cuotas.
        installments:
          r.installments === "1 de 1" ? undefined : normalizeInstallments(r.installments),
      };
    })
    .filter((m): m is BankMovement => m !== null);
}

/** Arma el `CreditCardBalance` a partir de los cupos y fechas leídos del DOM. */
export function parseCreditCardInfo(data: RawCreditCardInfo): CreditCardBalance {
  const ccBalance: CreditCardBalance = {
    label: data.label || "Tarjeta de Crédito BICE",
  };

  if (
    data.nationalUsed !== undefined ||
    data.nationalAvailable !== undefined ||
    data.nationalTotal !== undefined
  ) {
    ccBalance.national = {
      used: data.nationalUsed || 0,
      available: data.nationalAvailable || 0,
      total: data.nationalTotal || 0,
    };
  }

  if (
    data.internationalUsed !== undefined ||
    data.internationalAvailable !== undefined ||
    data.internationalTotal !== undefined
  ) {
    ccBalance.international = {
      used: data.internationalUsed || 0,
      available: data.internationalAvailable || 0,
      total: data.internationalTotal || 0,
      currency: "USD",
    };
  }

  if (data.billingPeriod) ccBalance.billingPeriod = data.billingPeriod;
  if (data.nextBillingDate) ccBalance.nextBillingDate = data.nextBillingDate;

  return ccBalance;
}
