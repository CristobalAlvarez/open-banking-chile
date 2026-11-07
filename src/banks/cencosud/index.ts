import type {
  BankScraper,
  BankMovement,
  CreditCardBalance,
  ScrapeResult,
  ScraperOptions,
} from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { deduplicateMovements } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { BANK_URL, login } from "./login.js";
import { openBilledMovements, openMovementsPage } from "./navigation.js";
import {
  extractCardLabel,
  extractDashboardBalance,
  extractTabMovements,
  extractTableMovements,
} from "./extract.js";

const BANK_ID = "cencosud";

async function scrapeCencosud(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  // 5b. Extract balance from the "Mis Productos" dashboard card
  debugLog.push("5b. Extracting dashboard balance...");
  const dashBalance = await extractDashboardBalance(page);
  if (dashBalance) {
    debugLog.push(
      `  Utilizado: ${dashBalance.used} | Disponible: ${dashBalance.available} | Cupo Total: ${dashBalance.total}`
    );
  } else {
    debugLog.push("  Balance card not found");
  }

  // 6. Navigate to full movements page via "Ver todos"
  debugLog.step("Navigating to full movements page...");
  progress("Abriendo página de movimientos...");

  await openMovementsPage(page, debugLog);
  await doSave(page, "04-movements-page");

  // 7. Extract card label from movements page header
  debugLog.step("Extracting card label...");
  const cardLabel = await extractCardLabel(page);
  debugLog.push(`  Label: ${cardLabel}`);

  // 8. Extract UNBILLED movements — Nacionales tab
  debugLog.step("Extracting unbilled movements...");
  progress("Extrayendo movimientos no facturados...");

  const unbilledNac = await extractTabMovements(
    page,
    "nacionales",
    MOVEMENT_SOURCE.credit_card_unbilled,
    debugLog
  );
  debugLog.push(`  Unbilled nacionales: ${unbilledNac.length}`);

  const unbilledInt = await extractTabMovements(
    page,
    "internacionales",
    MOVEMENT_SOURCE.credit_card_unbilled,
    debugLog
  );
  debugLog.push(`  Unbilled internacionales: ${unbilledInt.length}`);

  // 9. Navigate to BILLED movements
  debugLog.step("Navigating to billed movements...");
  progress("Abriendo movimientos facturados...");

  const billedNavOk = await openBilledMovements(page, debugLog);

  let billedMovements: BankMovement[] = [];

  if (billedNavOk) {
    await doSave(page, "05-billed-page");
    // Billed page has no nacionales/internacionales tabs — extract once
    billedMovements = await extractTableMovements(
      page,
      MOVEMENT_SOURCE.credit_card_billed,
      debugLog
    );
    debugLog.push(`  Billed: ${billedMovements.length}`);
  } else {
    debugLog.push("  Could not navigate to billed movements");
  }

  // 10. Combine and deduplicate
  const allMovements = deduplicateMovements([...unbilledNac, ...unbilledInt, ...billedMovements]);
  debugLog.step(`Total movements: ${allMovements.length}`);
  progress(`Listo — ${allMovements.length} movimientos`);

  await doSave(page, "06-final");
  const ss = doScreenshots
    ? await page.screenshot({ encoding: "base64", fullPage: true })
    : undefined;

  const creditCard: CreditCardBalance = {
    label: cardLabel,
    ...(dashBalance ? { national: dashBalance } : {}),
    movements: allMovements,
  };

  return {
    success: true,
    bank: BANK_ID,
    accounts: [],
    creditCards: [creditCard],
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const cencosud: BankScraper = {
  id: BANK_ID,
  name: "Tarjeta Cencosud",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeCencosud),
};

export default cencosud;
