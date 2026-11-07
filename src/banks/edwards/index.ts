import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { extractAccountMovements } from "../../steps/extraction.js";
import { extractBalance } from "../../steps/balance.js";
import { clickTcTab, extractCreditCardMovements } from "../../steps/credit-card.js";
import { BANK_URL, login } from "./login.js";
import { openAccountMovements, openCreditCards, tryExpandDateRange } from "./navigation.js";
import { paginate } from "./pagination.js";

const BANK_ID = "edwards";

async function scrapeEdwards(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { page, debugLog, screenshot: doSave, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // Cuenta
  debugLog.step("Looking for Cartola/Movimientos...");
  progress("Buscando cartola de cuenta...");
  await openAccountMovements(page, debugLog);
  await tryExpandDateRange(page, debugLog);
  let movements = deduplicateMovements(await paginate(page, extractAccountMovements));

  // Tarjeta de crédito
  debugLog.step("Navigating to Tarjetas de Crédito...");
  progress("Navegando a tarjeta de crédito...");
  if (await openCreditCards(page)) {
    if (await clickTcTab(page, "movimientos por facturar")) {
      const unbilled = await paginate(page, (p) => extractCreditCardMovements(p, "unbilled"));
      movements.push(...unbilled);
      debugLog.push(`  TC por facturar: ${unbilled.length}`);
    }
    if (await clickTcTab(page, "movimientos facturados")) {
      const billed = await paginate(page, (p) => extractCreditCardMovements(p, "billed"));
      movements.push(...billed);
      debugLog.push(`  TC facturados: ${billed.length}`);
    }
    movements = deduplicateMovements(movements);
  }

  debugLog.step(`Extracted ${movements.length} movements`);
  progress(`Listo — ${movements.length} movimientos totales`);

  let balance: number | undefined = movements.find((m) => m.balance > 0)?.balance;
  if (balance === undefined || balance === 0) balance = await extractBalance(page);

  await doSave(page, "04-final");
  const screenshot = options.saveScreenshots
    ? await page.screenshot({ encoding: "base64", fullPage: true })
    : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance: balance || undefined, movements }],
    screenshot,
    debug: debugLog.join("\n"),
  };
}

const edwards: BankScraper = {
  id: BANK_ID,
  name: "Banco Edwards",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeEdwards),
};

export default edwards;
