import type { ScrapeResult } from "../core/types.js";
import type { BrowserSession } from "./browser.js";

/**
 * Resultado de fallo estándar de un scraper: el mensaje de error, una captura de la página
 * como quedó y el log de depuración completo.
 *
 * La captura es de ayuda y puede no existir: una página en blanco o bloqueada (ancho 0) hace
 * fallar `screenshot`, y eso no debe tapar el motivo real del fallo.
 */
export async function failScrape(
  session: BrowserSession,
  bank: string,
  error: string
): Promise<ScrapeResult> {
  const screenshot = await session.page.screenshot({ encoding: "base64" }).catch(() => undefined);
  return {
    success: false,
    bank,
    accounts: [],
    error,
    screenshot,
    debug: session.debugLog.join("\n"),
  };
}
