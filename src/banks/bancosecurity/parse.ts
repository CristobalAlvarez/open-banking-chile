import { normalizeDate, parseChileanAmount } from "../../core/parsing.js";
import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";

/**
 * Parses the fixed-width TXT format from Banco Security cartola histórica.
 * Lines starting with "2" are movement records:
 *   "2" + 10-char date (DD/MM/YYYY) + 50-char description + 9-char doc + 1-char type (C/A) + "+" + amount + balance
 * "C" = Cargo (debit → negative), "A" = Abono (credit → positive)
 */
export function parseTxtMovements(txt: string): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const rawLine of txt.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("2")) continue;
    // date: chars 1-10, desc: 11-60, doc: 61-69, type: 70, "+": 71, rest: amounts
    const rawDate = line.slice(1, 11).trim(); // "DD/MM/YYYY"
    const rawDesc = line.slice(11, 61).trim();
    const typeChar = line.slice(70, 71); // "C" or "A"
    const rest = line.slice(72); // "+       48000,00    16588418,00"
    if (!/\d{1,2}\/\d{1,2}\/\d{4}/.test(rawDate)) continue;

    // rest contains two Chilean amounts separated by whitespace
    const parts = rest.trim().split(/\s+/);
    if (parts.length < 1) continue;
    const rawAmount = parts[0];
    const rawBalance = parts[1] ?? "";

    let amount = parseChileanAmount(rawAmount);
    if (amount === 0) continue;
    if (typeChar === "C") amount = -Math.abs(amount);
    else amount = Math.abs(amount);

    movements.push({
      date: normalizeDate(rawDate),
      description: rawDesc,
      amount,
      balance: rawBalance ? parseChileanAmount(rawBalance) : 0,
      source: MOVEMENT_SOURCE.account,
    });
  }
  return movements;
}
