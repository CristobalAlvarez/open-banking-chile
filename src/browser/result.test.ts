import { describe, it, expect } from "vitest";
import { DebugLog } from "../core/debug-log.js";
import type { BrowserSession } from "./browser.js";
import { failScrape } from "./result.js";

describe("failScrape", () => {
  it("devuelve el motivo del fallo aunque no se pueda tomar la captura (página en blanco o bloqueada)", async () => {
    const debugLog = new DebugLog();
    debugLog.step("Submitting login...");
    const session = {
      page: {
        screenshot: async () => {
          throw new Error(
            "Protocol error (Page.captureScreenshot): Cannot take screenshot with 0 width."
          );
        },
      },
      debugLog,
    } as unknown as BrowserSession;

    const result = await failScrape(session, "itau", "Itaú bloqueó el inicio de sesión");

    expect(result).toMatchObject({
      success: false,
      bank: "itau",
      error: "Itaú bloqueó el inicio de sesión",
      debug: "1. Submitting login...",
    });
    expect(result.screenshot).toBeUndefined();
  });
});
