import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { createInterceptor } from "../../browser/intercept.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { delay } from "../../core/delay.js";
import { extractBalance } from "../../steps/balance.js";
import {
  BANK_ID,
  BANK_URL,
  SANTANDER_CC_API_PREFIX,
  SANTANDER_CC_BILLED_API_PREFIX,
  SANTANDER_CHECKING_API_PREFIX,
} from "./constants.js";
import { login } from "./login.js";
import { listMovementAccounts, navigateToMovements } from "./navigation.js";
import { collectAccountMovements, collectCreditCardMovements } from "./extract.js";

async function scrapeSantander(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // Install API interceptor before first page.goto()
  const interceptor = await createInterceptor(page, [
    { id: "santander-checking", urlPrefix: SANTANDER_CHECKING_API_PREFIX },
    { id: "santander-credit-card-unbilled", urlPrefix: SANTANDER_CC_API_PREFIX },
    { id: "santander-credit-card-billed", urlPrefix: SANTANDER_CC_BILLED_API_PREFIX },
  ]);

  // 1-6. Login
  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // 7. Navigate to movements
  debugLog.step("Navigating to movements...");
  progress("Extrayendo movimientos de cuenta...");
  await navigateToMovements(page, debugLog);
  await delay(4000);
  await doSave(page, "04-movements");

  // Multi-account handling
  const accounts = await listMovementAccounts(page);
  if (accounts.length > 0) {
    debugLog.push(`  Accounts: ${accounts.map((a) => a.label).join(" | ")}`);
  }

  let movements = deduplicateMovements(
    await collectAccountMovements(page, interceptor, accounts, debugLog)
  );

  // 7b. Credit card movements
  debugLog.push("7b. Navigating to credit card movements...");
  progress("Extrayendo movimientos de tarjeta de crédito...");
  movements.push(...(await collectCreditCardMovements(page, interceptor, debugLog)));
  movements = deduplicateMovements(movements);

  // 8. Balance
  let balance: number | undefined;
  const withBalance = movements.find((m) => m.balance > 0);
  if (withBalance) {
    balance = withBalance.balance;
    debugLog.push(`  Balance from movements: $${balance.toLocaleString("es-CL")}`);
  }
  if (balance === undefined || balance === 0) {
    balance = await extractBalance(page);
  }

  debugLog.step(`Extracted ${movements.length} movement(s)`);
  progress(`Listo — ${movements.length} movimientos totales`);
  debugLog.push(
    balance !== undefined
      ? `9. Balance: $${balance.toLocaleString("es-CL")}`
      : "9. Balance not found"
  );

  await doSave(page, "05-final");
  const ss = doScreenshots
    ? await page.screenshot({ encoding: "base64", fullPage: true })
    : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance, movements }],
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const santander: BankScraper = {
  id: BANK_ID,
  name: "Banco Santander",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeSantander),
};

export default santander;
