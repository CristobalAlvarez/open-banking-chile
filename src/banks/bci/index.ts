import type {
  AccountBalance,
  BankMovement,
  BankScraper,
  CreditCardBalance,
  ScrapeResult,
  ScraperOptions,
} from "../../core/types.js";
import { closePopups } from "../../steps/popups.js";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { createInterceptor } from "../../browser/intercept.js";
import {
  BANK_ID,
  BANK_URL,
  BCI_CHECKING_API_PREFIX,
  IFRAME_PATTERNS,
  TC_COMBINATIONS,
} from "./constants.js";
import { login } from "./login.js";
import { clickByTitle, waitForFrame } from "./navigation.js";
import {
  extractAccountOptions,
  extractBalance,
  extractCreditCardLabels,
  extractCupo,
  extractMovementsFromFrame,
  extractTCMovements,
  selectAccount,
} from "./extract.js";
import { buildCreditCardBalances, normalizeBciApiMovements } from "./parse.js";

async function scrapeBci(session: BrowserSession, options: ScraperOptions): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // Install API interceptor before first page.goto()
  const interceptor = await createInterceptor(page, [
    { id: "bci-checking", urlPrefix: BCI_CHECKING_API_PREFIX },
  ]);

  progress("Abriendo sitio del banco...");
  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  progress("Sesión iniciada correctamente");
  await closePopups(page);
  await delay(2000);

  // Account movements
  progress("Extrayendo movimientos de cuenta...");
  debugLog.step("Fetching account movements...");
  const allMovements: BankMovement[] = [];
  let balance: number | undefined;

  if (await clickByTitle(page, "Últimos Movimientos")) {
    const movFrame = await waitForFrame(page, IFRAME_PATTERNS.movements, 15000);
    if (movFrame) {
      await delay(3000);

      // Try API interception first
      const captured = await interceptor.waitFor("bci-checking", 10_000);
      if (captured.length > 0) {
        debugLog.push(`  Checking API: ${captured.length} response(s) captured`);
        const apiMovements = normalizeBciApiMovements(captured);
        debugLog.push(`  Checking API movements: ${apiMovements.length}`);
        if (apiMovements.length > 0) {
          allMovements.push(...apiMovements);
          // Still extract balance from the iframe DOM
          balance = await extractBalance(movFrame);
        }
      }

      if (allMovements.length === 0) {
        debugLog.push("  Checking API: no data, falling back to HTML extraction");
        const accounts = await extractAccountOptions(movFrame);
        debugLog.push(`  Found ${accounts.length} account(s)`);

        for (let i = 0; i < accounts.length; i++) {
          if (i > 0) {
            await selectAccount(movFrame, accounts[i].value);
            await delay(3000);
          }
          if (balance === undefined) {
            balance = await extractBalance(movFrame);
          }
          const movements = await extractMovementsFromFrame(movFrame, debugLog);
          const prefixed =
            accounts.length > 1
              ? movements.map((m) => ({
                  ...m,
                  description: `[${accounts[i].label}] ${m.description}`.trim(),
                }))
              : movements;
          allMovements.push(...prefixed);
        }
      }
    }
  }

  // Credit cards
  progress("Extrayendo datos de tarjeta de crédito...");
  debugLog.step("Navigating to credit cards...");
  const creditCards: CreditCardBalance[] = [];
  if (await clickByTitle(page, "Tarjetas")) {
    await delay(3000);
    const cardLabels = await extractCreditCardLabels(page);

    if (cardLabels.length > 0 && (await clickByTitle(page, "Mis movimientos"))) {
      const tcFrame = await waitForFrame(page, IFRAME_PATTERNS.tcMovements, 15000);
      if (tcFrame) {
        await delay(3000);
        for (const { tab, billingType, source } of TC_COMBINATIONS) {
          const movements = await extractTCMovements(tcFrame, tab, billingType, source, debugLog);
          allMovements.push(...movements);
        }
      }

      if (await clickByTitle(page, "Cupo disponible")) {
        const cupoFrame = await waitForFrame(page, IFRAME_PATTERNS.tcCupo, 15000);
        if (cupoFrame) {
          await delay(3000);
          const cupoData = await extractCupo(cupoFrame);
          creditCards.push(...buildCreditCardBalances(cardLabels, cupoData));
        }
      }
    }
  }

  const deduplicated = deduplicateMovements(allMovements);
  debugLog.push(`  Total: ${deduplicated.length} unique movements`);
  progress(`Listo — ${deduplicated.length} movimientos totales`);
  await doSave(page, "06-final");
  const ss = doScreenshots ? await page.screenshot({ encoding: "base64" }) : undefined;

  const accounts: AccountBalance[] = [{ balance, movements: deduplicated }];
  return {
    success: true,
    bank: BANK_ID,
    accounts,
    creditCards: creditCards.length > 0 ? creditCards : undefined,
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const bci: BankScraper = {
  id: BANK_ID,
  name: "BCI",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeBci),
};

export default bci;
