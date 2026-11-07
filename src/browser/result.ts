import type { ScrapeResult } from "../core/types.js";
import type { BrowserSession } from "./browser.js";

/**
 * Resultado de fallo estándar de un scraper: el mensaje de error, una captura de la página
 * como quedó y el log de depuración completo.
 */
export async function failScrape(
  session: BrowserSession,
  bank: string,
  error: string
): Promise<ScrapeResult> {
  const screenshot = await session.page.screenshot({ encoding: "base64" });
  return {
    success: false,
    bank,
    accounts: [],
    error,
    screenshot,
    debug: session.debugLog.join("\n"),
  };
}
