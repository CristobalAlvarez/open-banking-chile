import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { closePopups } from "../../steps/popups.js";
import { login } from "./login.js";
import { extractBalance, extractCreditCardData, extractMovements } from "./extract.js";
import { assembleItauResult } from "./parse.js";

const BANK_ID = "itau";

async function scrapeItau(session: BrowserSession, options: ScraperOptions): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots } = options;
  const { page, debugLog, screenshot: doSave, saveHtml: doSaveHtml, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  progress("Sesión iniciada correctamente");
  await closePopups(page);

  progress("Extrayendo saldo...");
  const balance = await extractBalance(page, debugLog, doSaveHtml);

  progress("Extrayendo movimientos de cuenta...");
  const accountMovements = await extractMovements(page, debugLog, doSaveHtml);
  progress(`Cuenta: ${accountMovements.length} movimientos`);

  progress("Extrayendo datos de tarjeta de crédito...");
  const tcResult = await extractCreditCardData(page, debugLog, doSaveHtml);

  const assembled = assembleItauResult({
    balance,
    accountMovements,
    creditCards: tcResult.creditCards,
    creditCardMovements: tcResult.movements,
  });
  if (!assembled.ok) return failScrape(session, BANK_ID, assembled.error);
  for (const warning of assembled.warnings) debugLog.push(`  ADVERTENCIA: ${warning}`);

  const { accounts, creditCards } = assembled;
  const totalTc = creditCards[0]?.movements?.length ?? 0;

  debugLog.step(`Total: ${accountMovements.length} account + ${totalTc} TC movements`);
  progress(`Listo — ${accountMovements.length + totalTc} movimientos totales`);
  await doSave(page, "05-final");
  const ss = doScreenshots ? await page.screenshot({ encoding: "base64" }) : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts,
    creditCards: creditCards.length > 0 ? creditCards : undefined,
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

const itau: BankScraper = {
  id: "itau",
  name: "Itaú",
  url: "https://banco.itau.cl",
  // Itaú sits behind Imperva (reese84): headless Chrome and a User-Agent that
  // doesn't match the installed Chrome build both get the session blocked.
  // Requires a display — on headless Linux use Xvfb (DISPLAY=:99).
  scrape: (options) =>
    runScraper("itau", options, { forceHeadful: true, skipUserAgentOverride: true }, scrapeItau),
};

export default itau;
