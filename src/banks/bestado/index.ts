import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { BANK_ID, BANK_NAME, BANK_URL } from "./constants.js";
import { collectMovements, extractBalanceFromDashboard } from "./extract.js";
import { login } from "./login.js";
import { openMovements } from "./navigation.js";

async function scrapeBestado(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1-5. Login
  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // 6. Balance
  debugLog.step("Extracting CuentaRUT balance...");
  progress("Extrayendo saldo CuentaRUT...");
  const balance = await extractBalanceFromDashboard(page, debugLog);
  await doSave(page, "05-dashboard");

  // 7. Navigate to movements
  debugLog.step("Navigating to CuentaRUT movements...");
  progress("Navegando a movimientos CuentaRUT...");
  await openMovements(page, debugLog);

  await doSave(page, "06-movements-page");

  // 8. Extract movements with pagination
  debugLog.step("Extracting movements...");
  progress("Extrayendo movimientos...");
  const movements = await collectMovements(page, debugLog);

  const deduplicated = deduplicateMovements(movements);
  debugLog.push(`  Total: ${deduplicated.length} unique movements`);
  progress(`Listo — ${deduplicated.length} movimientos totales`);

  await doSave(page, "07-final");
  const ss = doScreenshots ? await page.screenshot({ encoding: "base64" }) : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance, movements: deduplicated }],
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const bestado: BankScraper = {
  id: BANK_ID,
  name: BANK_NAME,
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, { forceHeadful: true }, scrapeBestado),
};

export default bestado;
