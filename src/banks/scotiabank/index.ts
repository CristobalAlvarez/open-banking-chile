import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { resolveMonths } from "../../core/parsing.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { BANK_ID, BANK_URL } from "./constants.js";
import { extractBalance } from "./extract.js";
import { fetchHistoricalCartolas } from "./history.js";
import { login } from "./login.js";
import {
  dismissScotiaTutorial,
  expandDateRange,
  navigateToMovements,
  waitForMovementsContent,
} from "./navigation.js";
import { scotiaPaginate } from "./pagination.js";

async function scrapeScotiabank(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // 7. Navigate to cartola
  debugLog.step("Looking for Cartola/Movimientos...");
  progress("Buscando cartola de cuenta...");
  await navigateToMovements(page, debugLog);
  await dismissScotiaTutorial(page, debugLog);

  // Wait for movements table to load (spinner to disappear)
  debugLog.push("7b. Waiting for movements to load...");
  progress("Esperando carga de movimientos...");
  await waitForMovementsContent(page, debugLog);

  await doSave(page, "04-movements-page");

  // 8. Try expanding date range
  await expandDateRange(page);

  // 9. Extract current period
  const movements = await scotiaPaginate(page, debugLog);
  debugLog.step(`Extracted ${movements.length} movements (current period)`);
  progress(`Periodo actual: ${movements.length} movimientos`);

  // 10. Historical periods via "Consultar Cartolas" (month/year dropdowns)
  const months = resolveMonths(options.historicalMonths, 3, 12);
  if (months > 0) {
    debugLog.step(`Fetching ${months} historical cartola(s)...`);
    progress(`Extrayendo cartolas históricas...`);
    movements.push(...(await fetchHistoricalCartolas(session, months)));
  }

  const deduplicated = deduplicateMovements(movements);
  debugLog.push(`  Total: ${deduplicated.length} unique movements`);
  progress(`Listo — ${deduplicated.length} movimientos totales`);

  let balance: number | undefined;
  if (deduplicated.length > 0 && deduplicated[0].balance > 0) balance = deduplicated[0].balance;
  if (balance === undefined) {
    balance = await extractBalance(page);
  }

  await doSave(page, "05-final");
  const ss = doScreenshots
    ? await page.screenshot({ encoding: "base64", fullPage: true })
    : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance: balance ?? undefined, movements: deduplicated }],
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const scotiabank: BankScraper = {
  id: BANK_ID,
  name: "Scotiabank Chile",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeScotiabank),
};

export default scotiabank;
