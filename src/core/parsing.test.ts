import { describe, it, expect } from "vitest";
import { normalizeDate, normalizeInstallments, parseUsdAmount, resolveMonths } from "./parsing.js";

// ─── normalizeDate ───────────────────────────────────────────────

describe("normalizeDate", () => {
  it("converts ISO dates, with or without time, to dd-mm-yyyy", () => {
    expect(normalizeDate("2026-03-22")).toBe("22-03-2026");
    expect(normalizeDate("2026-03-22T14:30:00")).toBe("22-03-2026");
  });

  it("keeps normalizing the existing dd/mm/yyyy and month-name formats", () => {
    expect(normalizeDate("9/3/2026")).toBe("09-03-2026");
    expect(normalizeDate("9 mar 2026")).toBe("09-03-2026");
  });
});

// ─── normalizeInstallments ───────────────────────────────────────

describe("normalizeInstallments", () => {
  it("normaliza N/M, N de M y textos que lo contienen a NN/NN", () => {
    expect(normalizeInstallments("1/3")).toBe("01/03");
    expect(normalizeInstallments("12/06")).toBe("12/06");
    expect(normalizeInstallments("3 de 12")).toBe("03/12");
    expect(normalizeInstallments("Cuota 2/12")).toBe("02/12");
  });

  it("devuelve undefined cuando no hay cuotas reconocibles (nunca texto libre)", () => {
    expect(normalizeInstallments("3 Cuotas")).toBeUndefined();
    expect(normalizeInstallments("N/A")).toBeUndefined();
    expect(normalizeInstallments("")).toBeUndefined();
    expect(normalizeInstallments(undefined)).toBeUndefined();
  });

  it("no confunde una fecha con cuotas", () => {
    expect(normalizeInstallments("12/05/2026")).toBeUndefined();
  });
});

// ─── resolveMonths ───────────────────────────────────────────────

describe("resolveMonths", () => {
  it("uses the fallback when the option is not provided", () => {
    expect(resolveMonths(undefined, 3, 12)).toBe(3);
  });

  it("treats 0 as an explicit 'no extra periods', not as missing", () => {
    expect(resolveMonths(0, 3, 12)).toBe(0);
  });

  it("clamps to [0, max]", () => {
    expect(resolveMonths(99, 0, 16)).toBe(16);
    expect(resolveMonths(-4, 3, 12)).toBe(0);
  });

  it("truncates fractions and falls back on non-finite values", () => {
    expect(resolveMonths(2.9, 0, 12)).toBe(2);
    expect(resolveMonths(Number.NaN, 3, 12)).toBe(3);
  });
});

// ─── parseUsdAmount ──────────────────────────────────────────────

describe("parseUsdAmount", () => {
  it("parses a USD amount with decimal comma", () => {
    expect(parseUsdAmount("USD 47,61")).toBe(47.61);
  });

  it("parses thousands separator and decimals", () => {
    expect(parseUsdAmount("USD 1.234,56")).toBe(1234.56);
  });

  it("parses negative amounts", () => {
    expect(parseUsdAmount("USD -34,36")).toBe(-34.36);
  });

  it("returns 0 for empty input", () => {
    expect(parseUsdAmount("")).toBe(0);
  });
});
