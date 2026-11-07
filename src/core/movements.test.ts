import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE, type BankMovement } from "./types.js";
import { deduplicateMovements } from "./movements.js";

// ─── deduplicateMovements ────────────────────────────────────────

function movement(overrides: Partial<BankMovement> = {}): BankMovement {
  return {
    date: "01-01-2026",
    description: "Pago supermercado",
    amount: -15000,
    balance: 100000,
    source: MOVEMENT_SOURCE.account,
    ...overrides,
  };
}

describe("deduplicateMovements", () => {
  it("removes exact duplicates from HTML-scraped movements (balance > 0)", () => {
    const m = movement({ balance: 100000 });
    const result = deduplicateMovements([m, m, m]);
    expect(result).toHaveLength(1);
  });

  it("keeps all API-sourced movements with balance=0, even if identical", () => {
    // Two identical toll charges on the same day are both real transactions
    const m = movement({ balance: 0, description: "Peaje autopista", amount: -1800 });
    const result = deduplicateMovements([m, m]);
    expect(result).toHaveLength(2);
  });

  it("does not deduplicate when amount differs", () => {
    const a = movement({ amount: -1000, balance: 99000 });
    const b = movement({ amount: -2000, balance: 97000 });
    expect(deduplicateMovements([a, b])).toHaveLength(2);
  });

  it("does not deduplicate when date differs", () => {
    const a = movement({ date: "01-01-2026", balance: 99000 });
    const b = movement({ date: "02-01-2026", balance: 98000 });
    expect(deduplicateMovements([a, b])).toHaveLength(2);
  });

  it("does not deduplicate when description differs", () => {
    const a = movement({ description: "Comercio A", balance: 99000 });
    const b = movement({ description: "Comercio B", balance: 99000 });
    expect(deduplicateMovements([a, b])).toHaveLength(2);
  });

  it("deduplicates movements from paginated HTML (same balance key)", () => {
    // When the same page is fetched twice, the balance is identical
    const m = movement({ balance: 87500 });
    expect(deduplicateMovements([m, m])).toHaveLength(1);
  });

  it("keeps legitimately repeated transactions with different balances", () => {
    // Two coffees at $3000 each produce different running balances
    const first = movement({ description: "Café", amount: -3000, balance: 97000 });
    const second = movement({ description: "Café", amount: -3000, balance: 94000 });
    expect(deduplicateMovements([first, second])).toHaveLength(2);
  });

  it("handles an empty array", () => {
    expect(deduplicateMovements([])).toEqual([]);
  });

  it("preserves order of first occurrences", () => {
    const a = movement({ description: "A", balance: 100 });
    const b = movement({ description: "B", balance: 200 });
    const result = deduplicateMovements([a, b, a]);
    expect(result.map((m) => m.description)).toEqual(["A", "B"]);
  });
});
