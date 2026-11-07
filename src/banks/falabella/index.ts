import type { Browser } from "playwright-core";
import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import { launchPlaywright, screenshotIfEnabled } from "../../browser/playwright.js";
import { BANK_URL, login } from "./login.js";
import { goToDashboard, openAccountSection } from "./navigation.js";
import { extractAccountData } from "./account.js";
import { scrapeCmrCard } from "./cmr.js";

async function scrapeFalabella(options: ScraperOptions): Promise<ScrapeResult> {
  const { rut, password, saveScreenshots: doScreenshots = false, owner = "B" } = options;
  const progress = options.onProgress || (() => {});
  const bank = "falabella";

  if (!rut || !password) {
    return { success: false, bank, accounts: [], error: "Debes proveer RUT y clave." };
  }

  let browser: Browser | undefined;

  try {
    const session = await launchPlaywright(options);
    browser = session.browser;
    const { page, debugLog } = session;

    // Login
    const loginResult = await login(page, rut, password, debugLog, doScreenshots, progress);
    if (!loginResult.success) {
      return {
        success: false,
        bank,
        accounts: [],
        error: loginResult.error,
        screenshot: loginResult.screenshot,
        debug: debugLog.join("\n"),
      };
    }

    const dashboardUrl = page.url();
    await screenshotIfEnabled(page, "04-post-login", doScreenshots, debugLog);

    // Phase 1: Account movements
    await openAccountSection(page, debugLog, doScreenshots, progress);
    const { movements: accountMovements, balance } = await extractAccountData(
      page,
      debugLog,
      progress
    );

    // Phase 2: CMR credit card — navigate back to dashboard first
    debugLog.push("  Navigating back to dashboard for CMR...");
    progress("Navegando a tarjeta de crédito...");
    await goToDashboard(page, dashboardUrl);

    const { creditCard } = await scrapeCmrCard(page, debugLog, doScreenshots, progress, owner);

    const totalMov = accountMovements.length + (creditCard.movements?.length ?? 0);
    debugLog.step(
      `Total: ${accountMovements.length} account + ${creditCard.movements?.length ?? 0} TC = ${totalMov}`
    );
    progress(`Listo — ${totalMov} movimientos totales`);

    await screenshotIfEnabled(page, "08-final", doScreenshots, debugLog);
    const ss = doScreenshots
      ? (await page.screenshot({ fullPage: true })).toString("base64")
      : undefined;

    // Logout
    try {
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll("a, button, span"))) {
          const text = (el as HTMLElement).innerText?.trim().toLowerCase();
          if (text === "cerrar sesión" || text === "cerrar sesion" || text === "salir") {
            (el as HTMLElement).click();
            return;
          }
        }
      });
      await delay(2000);
    } catch {
      /* best effort */
    }

    return {
      success: true,
      bank,
      accounts: [{ balance, movements: deduplicateMovements(accountMovements) }],
      creditCards: [creditCard],
      screenshot: ss,
      debug: debugLog.join("\n"),
    };
  } catch (error) {
    return {
      success: false,
      bank,
      accounts: [],
      error: `Error del scraper: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

const falabella: BankScraper = {
  id: "falabella",
  name: "Banco Falabella",
  url: BANK_URL,
  scrape: scrapeFalabella,
};

export default falabella;
