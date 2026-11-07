import type {
  BankScraper,
  CreditCardBalance,
  ScrapeResult,
  ScraperOptions,
} from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { closePopups } from "../../steps/popups.js";
import { delay } from "../../core/delay.js";
import { resolveMonths } from "../../core/parsing.js";
import { deduplicateMovements } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { BANK_URL, login } from "./login.js";
import {
  clickBilledPeriod,
  clickTcTab,
  dismissAdPopup,
  navigateToTcMovements,
  openAccountMovements,
  openHistoricalPeriods,
  selectPeriod,
} from "./navigation.js";
import {
  extractAccountBalance,
  extractCreditCardInfo,
  extractCurrentMonthMovements,
  extractHistoricalMovements,
  extractTcMovementsFromPage,
} from "./extract.js";
import { paginate } from "./pagination.js";

const BANK_ID = "bice";

async function scrapeBice(session: BrowserSession, options: ScraperOptions): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { debugLog, screenshot: doSave, progress } = session;

  progress("Abriendo sitio del banco...");
  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  progress("Sesión iniciada correctamente");
  const activePage = session.page;
  await dismissAdPopup(activePage, debugLog);
  await closePopups(activePage);

  // Balance
  const balance = await extractAccountBalance(activePage);
  debugLog.push(
    `  Balance: ${balance !== undefined ? `$${balance.toLocaleString("es-CL")}` : "not found"}`
  );

  // Navigate to movements
  progress("Navegando a movimientos...");
  debugLog.step("Navigating to movements...");
  if (!(await openAccountMovements(activePage))) {
    return failScrape(session, BANK_ID, "No se pudo navegar a movimientos");
  }
  await doSave(activePage, "05-movements-page");

  // Current month
  progress("Extrayendo movimientos del mes actual...");
  const movements = await paginate(activePage, extractCurrentMonthMovements);
  debugLog.step(`Current month: ${movements.length} movements`);
  progress(`Mes actual: ${movements.length} movimientos`);

  // Historical periods
  const months = resolveMonths(options.historicalMonths, 0, 16);
  if (months > 0) {
    debugLog.step(`Fetching ${months} historical period(s)...`);
    progress(`Extrayendo ${months} periodo(s) histórico(s)...`);
    if (await openHistoricalPeriods(activePage)) {
      const firstMovements = await paginate(activePage, (p) =>
        extractHistoricalMovements(p, debugLog)
      );
      debugLog.push(`  Period 1: ${firstMovements.length} movements`);
      movements.push(...firstMovements);

      for (let i = 1; i < months; i++) {
        if (!(await selectPeriod(activePage, i, debugLog))) break;
        const hist = await paginate(activePage, (p) => extractHistoricalMovements(p, debugLog));
        debugLog.push(`  Period ${i + 1}: ${hist.length} movements`);
        movements.push(...hist);
      }
    }
  }

  const deduplicated = deduplicateMovements(movements);
  debugLog.push(`  Total: ${deduplicated.length} unique movements`);
  progress(`Listo — ${deduplicated.length} movimientos totales`);

  // ── Credit card movements ─────────────────────────────────────
  let creditCards: CreditCardBalance[] | undefined;
  debugLog.push("TC: Starting credit card extraction...");
  progress("Extrayendo movimientos de tarjeta de crédito...");

  const tcNav = await navigateToTcMovements(activePage, debugLog);
  if (tcNav) {
    // Wait for transaction data to actually render (not just skeleton)
    debugLog.push("TC: Waiting for transaction data to load...");
    try {
      await activePage.waitForSelector("app-transaction-row", { timeout: 20000 });
      debugLog.push("TC: Transaction rows appeared");
    } catch {
      debugLog.push("TC: Transaction rows did not appear after 20s, trying anyway...");
    }
    await delay(2000);

    await doSave(activePage, "06-tc-page");

    // Extract credit card balance info
    const ccInfo = await extractCreditCardInfo(activePage, debugLog);
    if (ccInfo.balance) {
      creditCards = [ccInfo.balance];
    }

    // Extract unbilled movements (default tab: "Movimientos no facturados")
    const unbilled = await extractTcMovementsFromPage(
      activePage,
      MOVEMENT_SOURCE.credit_card_unbilled
    );
    debugLog.push(`TC: Unbilled movements: ${unbilled.length}`);
    movements.push(...unbilled);

    // Extract billed movements if BICE_MONTHS is set
    const tcMonths = resolveMonths(options.historicalMonths, 0, 11);
    if (tcMonths > 0) {
      debugLog.push(`TC: Fetching ${tcMonths} billed period(s)...`);
      progress(`Extrayendo ${tcMonths} periodo(s) facturado(s) de TC...`);

      // Switch to billed tab
      if (await clickTcTab(activePage, "Movimientos facturados")) {
        await doSave(activePage, "06b-tc-billed");
        await delay(2000);

        for (let i = 0; i < tcMonths; i++) {
          if (!(await clickBilledPeriod(activePage, i))) {
            debugLog.push(`TC: Period ${i + 1} not available`);
            break;
          }
          await delay(2000);
          const billed = await extractTcMovementsFromPage(
            activePage,
            MOVEMENT_SOURCE.credit_card_billed
          );
          debugLog.push(`TC: Billed period ${i + 1}: ${billed.length} movements`);
          movements.push(...billed);
        }
      }
    }
  } else {
    debugLog.push("TC: Could not navigate to credit card section");
  }

  const finalMovements = deduplicateMovements(movements);
  debugLog.push(
    `  Final total: ${finalMovements.length} movements (${deduplicated.length} account + ${finalMovements.length - deduplicated.length} TC)`
  );
  progress(`Listo — ${finalMovements.length} movimientos totales`);

  await doSave(activePage, "07-final");
  const ss = doScreenshots
    ? await activePage.screenshot({ encoding: "base64", fullPage: true })
    : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance: balance || undefined, movements: finalMovements }],
    creditCards: creditCards,
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const bice: BankScraper = {
  id: BANK_ID,
  name: "Banco BICE",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeBice),
};

export default bice;
