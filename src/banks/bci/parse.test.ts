import { describe, it, expect } from "vitest";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { buildCreditCardBalances, normalizeBciApiMovements } from "./parse.js";

describe("normalizeBciApiMovements", () => {
  it("returns empty array for empty captures", () => {
    expect(normalizeBciApiMovements([])).toEqual([]);
  });

  it("skips captures without a movimientos array", () => {
    expect(normalizeBciApiMovements([{ other: "data" }])).toEqual([]);
    expect(normalizeBciApiMovements([null])).toEqual([]);
    expect(normalizeBciApiMovements([{}])).toEqual([]);
  });

  it("parses a cargo movement (tipo=C → negative amount)", () => {
    const capture = {
      movimientos: [
        {
          fechaMovimiento: "2026-01-15T00:00:00",
          monto: "15990",
          tipo: "C",
          glosa: "Supermercado Lider",
        },
      ],
    };
    const result = normalizeBciApiMovements([capture]);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(-15990);
    expect(result[0].description).toBe("Supermercado Lider");
    expect(result[0].source).toBe(MOVEMENT_SOURCE.account);
    expect(result[0].balance).toBe(0);
  });

  it("parses an abono movement (tipo=A → positive amount)", () => {
    const capture = {
      movimientos: [
        {
          fechaMovimiento: "2026-02-10T00:00:00",
          monto: "500000",
          tipo: "A",
          glosa: "Depósito sueldo",
        },
      ],
    };
    const result = normalizeBciApiMovements([capture]);
    expect(result[0].amount).toBe(500000);
    expect(result[0].amount).toBeGreaterThan(0);
  });

  it("converts fechaMovimiento (ISO with time) to dd-mm-yyyy", () => {
    const capture = {
      movimientos: [
        { fechaMovimiento: "2026-03-22T14:30:00", monto: "1000", tipo: "C", glosa: "Test" },
      ],
    };
    const result = normalizeBciApiMovements([capture]);
    expect(result[0].date).toBe("22-03-2026");
  });

  it("rounds float amounts to the nearest integer", () => {
    const capture = {
      movimientos: [
        { fechaMovimiento: "2026-01-01T00:00:00", monto: "1499.9", tipo: "C", glosa: "Float test" },
      ],
    };
    const result = normalizeBciApiMovements([capture]);
    expect(result[0].amount).toBe(-1500);
  });

  it("skips movements with zero or NaN monto", () => {
    const capture = {
      movimientos: [
        { fechaMovimiento: "2026-01-01T00:00:00", monto: "0", tipo: "C", glosa: "Zero" },
        { fechaMovimiento: "2026-01-01T00:00:00", monto: "abc", tipo: "C", glosa: "NaN" },
      ],
    };
    expect(normalizeBciApiMovements([capture])).toHaveLength(0);
  });

  it("always sets balance to 0 (API does not provide running balance)", () => {
    const capture = {
      movimientos: [
        { fechaMovimiento: "2026-01-01T00:00:00", monto: "5000", tipo: "A", glosa: "Abono" },
      ],
    };
    const result = normalizeBciApiMovements([capture]);
    expect(result[0].balance).toBe(0);
  });

  it("accumulates movements across multiple captures", () => {
    const makeCapture = (glosa: string) => ({
      movimientos: [{ fechaMovimiento: "2026-01-01T00:00:00", monto: "1000", tipo: "C", glosa }],
    });
    const result = normalizeBciApiMovements([makeCapture("A"), makeCapture("B")]);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.description)).toEqual(["A", "B"]);
  });
});

describe("buildCreditCardBalances", () => {
  const cupo = {
    nationalUsed: 100000,
    nationalAvailable: 900000,
    nationalTotal: 1000000,
    internationalUsed: 0,
    internationalAvailable: 0,
    internationalTotal: 0,
  };

  it("builds one card per label with the national cupo and no international when total is 0", () => {
    const cards = buildCreditCardBalances(["Visa", "Mastercard"], cupo);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.label)).toEqual(["Visa", "Mastercard"]);
    expect(cards[0].national).toEqual({ used: 100000, available: 900000, total: 1000000 });
    expect(cards[0].movements).toEqual([]);
    expect(cards[0].international).toBeUndefined();
  });

  it("adds the international cupo in USD when the international total is positive", () => {
    const cards = buildCreditCardBalances(["Visa"], {
      ...cupo,
      internationalUsed: 100,
      internationalAvailable: 900,
      internationalTotal: 1000,
    });
    expect(cards[0].international).toEqual({
      used: 100,
      available: 900,
      total: 1000,
      currency: "USD",
    });
  });

  it("returns [] when there are no labels", () => {
    expect(buildCreditCardBalances([], cupo)).toEqual([]);
  });
});
