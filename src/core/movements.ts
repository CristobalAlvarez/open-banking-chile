import type { BankMovement } from "./types.js";

/** Elimina movimientos duplicados por fecha+descripción+monto+balance+source+owner */
export function deduplicateMovements(movements: BankMovement[]): BankMovement[] {
  const seen = new Set<string>();
  return movements.filter((m) => {
    // API-sourced movements have balance=0 (we don't get per-movement balance from the API).
    // These should never be deduplicated — the API is authoritative and two identical
    // charges (e.g. same toll twice in a day) are both real transactions.
    if (m.balance === 0) return true;

    // HTML-scraped movements carry the running account balance after each transaction.
    // The same row re-fetched across paginated pages will have the same balance,
    // so including it in the key correctly removes pagination duplicates while
    // keeping legitimately repeated transactions (which have different balances).
    const key = `${m.date}|${m.description}|${m.amount}|${m.balance ?? ""}|${m.source}|${m.owner ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deduplicates movements that appear in both unbilled and billed sources.
 * If the same transaction (date+description+amount) appears as both
 * credit_card_unbilled and credit_card_billed, keep only the billed one.
 */
export function deduplicateAcrossSources(movements: BankMovement[]): BankMovement[] {
  const billedKeys = new Set<string>();
  for (const m of movements) {
    if (m.source === "credit_card_billed") {
      billedKeys.add(`${m.date}|${m.description}|${m.amount}`);
    }
  }
  return movements.filter((m) => {
    if (m.source !== "credit_card_unbilled") return true;
    return !billedKeys.has(`${m.date}|${m.description}|${m.amount}`);
  });
}
