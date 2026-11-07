import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { resolveMonths } from "../../core/parsing.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { BANK_URL, login } from "./login.js";
import { fetchHistoricalMonths, navigateToMovements } from "./navigation.js";
import { paginate } from "./pagination.js";

const BANK_ID = "bancosecurity";

async function scrapeBancoSecurity(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { page, debugLog, screenshot: doSave, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // 7. Navigate to cartola
  debugLog.step("Navigating to cartola...");
  progress("Buscando cartola...");
  await navigateToMovements(page, debugLog);
  await doSave(page, "04-movements");

  // 8. Extract movements
  debugLog.step("Extracting movements...");
  progress("Extrayendo movimientos...");
  const currentMovements = await paginate(page, debugLog);
  debugLog.step(`Extracted ${currentMovements.length} current-period movements`);

  // Historical months via Cartola histórica (TXT format)
  const historicalMonths = resolveMonths(options.historicalMonths, 0, 24);
  let allMovements = currentMovements;
  if (historicalMonths > 0) {
    progress(`Obteniendo ${historicalMonths} mes(es) histórico(s)...`);
    const historical = await fetchHistoricalMonths(page, historicalMonths, debugLog);
    allMovements = deduplicateMovements([...currentMovements, ...historical]);
    debugLog.step(`Total after merging historical: ${allMovements.length} movements`);
  }

  const movements = allMovements;
  progress(`Listo — ${movements.length} movimientos`);
  await doSave(page, "05-final");

  let balance: number | undefined;
  if (movements.length > 0 && movements[0].balance > 0) balance = movements[0].balance;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance, movements }],
    debug: debugLog.join("\n"),
  };
}

const bancosecurity: BankScraper = {
  id: BANK_ID,
  name: "Banco Security",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeBancoSecurity),
};

export default bancosecurity;
