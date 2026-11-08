import { describe, it, expect } from "vitest";
import type { Page } from "puppeteer-core";
import { openAccountMovements } from "./navigation.js";

/** Página falsa: la navegación puede vencer su timeout y la tabla puede no aparecer. */
function portalPage(opts: { navigationTimesOut?: boolean; tableAppears: boolean }): Page {
  return {
    goto: async () => {
      if (opts.navigationTimesOut) throw new Error("Navigation timeout of 45000 ms exceeded");
      return null;
    },
    waitForSelector: async () => {
      if (!opts.tableAppears) throw new Error("Waiting for selector failed: timeout");
      return null;
    },
  } as unknown as Page;
}

describe("navegación del portal", () => {
  it("informa si apareció la tabla de la sección, sin lanzar cuando no aparece", async () => {
    expect(await openAccountMovements(portalPage({ tableAppears: true }))).toBe(true);
    expect(await openAccountMovements(portalPage({ tableAppears: false }))).toBe(false);
  });

  it("un timeout de la navegación no es fatal: la página sigue cargando y se espera la tabla", async () => {
    const page = portalPage({ navigationTimesOut: true, tableAppears: true });

    expect(await openAccountMovements(page)).toBe(true);
  });
});
