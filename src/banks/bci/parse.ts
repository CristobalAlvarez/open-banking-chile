import type { BankMovement, CreditCardBalance } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeDate } from "../../core/parsing.js";

interface BciApiMovement {
  fechaMovimiento: string;
  monto: string;
  tipo: string; // 'C' = cargo (debit), 'A' = abono (credit)
  glosa: string;
}

export function normalizeBciApiMovements(captures: unknown[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const capture of captures) {
    const obj = capture as { movimientos?: BciApiMovement[] };
    const list = obj?.movimientos;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const raw = Math.round(parseFloat(m.monto));
      if (!raw || isNaN(raw)) continue;
      const amount = m.tipo === "C" ? -raw : raw;
      const dateStr = m.fechaMovimiento?.split("T")[0] ?? "";
      movements.push({
        date: normalizeDate(dateStr),
        description: m.glosa ?? "",
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      });
    }
  }
  return movements;
}

export interface BciCupoData {
  nationalUsed: number;
  nationalAvailable: number;
  nationalTotal: number;
  internationalUsed: number;
  internationalAvailable: number;
  internationalTotal: number;
}

export function buildCreditCardBalances(
  cardLabels: string[],
  cupoData: BciCupoData
): CreditCardBalance[] {
  const creditCards: CreditCardBalance[] = [];
  for (const label of cardLabels) {
    const card: CreditCardBalance = {
      label,
      national: {
        used: cupoData.nationalUsed,
        available: cupoData.nationalAvailable,
        total: cupoData.nationalTotal,
      },
      movements: [],
    };
    if (cupoData.internationalTotal > 0)
      card.international = {
        used: cupoData.internationalUsed,
        available: cupoData.internationalAvailable,
        total: cupoData.internationalTotal,
        currency: "USD",
      };
    creditCards.push(card);
  }
  return creditCards;
}
