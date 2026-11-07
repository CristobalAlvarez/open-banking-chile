import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";

export async function dismissAdPopup(page: Page, debugLog: DebugLog): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const btn = await page.$("button.evg-btn-dismissal");
    if (btn) {
      await btn.click();
      debugLog.push("  Ad popup dismissed");
      await delay(1000);
      return;
    }
    await delay(2000);
  }
}

/** Abre la tabla de últimos movimientos de la cuenta. `false` si no encuentra el acceso. */
export async function openAccountMovements(page: Page): Promise<boolean> {
  const link = await page.$("a.ultimosMov");
  if (!link) return false;
  await link.click();
  try {
    await page.waitForSelector("div.transaction-table__container", { timeout: 15000 });
  } catch {
    /* timeout */
  }
  await delay(2000);
  return true;
}

/** Abre el selector "Revisar periodos anteriores". `false` si no encuentra el enlace. */
export async function openHistoricalPeriods(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const links = document.querySelectorAll("div.transactions-summary__link");
    for (const item of links) {
      if ((item as HTMLElement).innerText?.includes("Revisar periodos anteriores")) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  if (clicked) {
    try {
      await page.waitForSelector('ds-dropdown[toplabel="Elige un periodo"]', {
        timeout: 10000,
      });
    } catch {
      /* timeout */
    }
    await delay(2000);
  }

  return clicked;
}

/** Elige el periodo `periodIndex` del dropdown y dispara la búsqueda. */
export async function selectPeriod(
  page: Page,
  periodIndex: number,
  debugLog: DebugLog
): Promise<boolean> {
  await page.evaluate(() => {
    const selector = document.querySelector("ds-dropdown div.ds-selector");
    if (selector) (selector as HTMLElement).click();
  });
  await delay(1000);

  const periodLabel = await page.evaluate((idx: number) => {
    const items = document.querySelectorAll("ul.options.single li.li-single");
    if (idx >= items.length) return null;
    const span = items[idx].querySelector("span.label.header-ellipsis");
    const label = span?.textContent?.trim() || "";
    (items[idx] as HTMLElement).click();
    return label;
  }, periodIndex);

  if (!periodLabel) {
    debugLog.push(`  Period index ${periodIndex} not available`);
    return false;
  }
  debugLog.push(`  Selected period: ${periodLabel}`);

  await page.evaluate(() => {
    const container = document.querySelector("div.button-search");
    const btn = container?.querySelector("button");
    if (btn) btn.click();
  });
  await delay(7000);
  return true;
}

/** Llega a "Saldos y movimientos" de tarjeta de crédito: URL directa o menú lateral. */
export async function navigateToTcMovements(page: Page, debugLog: DebugLog): Promise<boolean> {
  debugLog.push("TC: Navigating to credit card movements...");

  // Try direct URL navigation with retries
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      debugLog.push(`TC: Direct URL attempt ${attempt}...`);
      await page.goto("https://portalpersonas.bice.cl/movimientos-tc", {
        waitUntil: "networkidle2",
        timeout: 20000,
      });

      // Wait for data to actually render (not just skeleton)
      try {
        await page.waitForSelector(
          "app-progression-chart h4.chart-title, span.transaction-amount",
          {
            timeout: 15000,
          }
        );
      } catch {
        // Data didn't load in time, retry
        debugLog.push(`TC: Data didn't render after 15s`);
        if (attempt < 3) {
          await delay(2000);
          continue;
        }
      }
      await delay(2000);

      // Check if the page loaded with TC content
      const pageText = await page.evaluate(() => {
        const body = document.body.innerText || "";
        return {
          hasCard: /Visa|Mastercard|Amex|Tarjeta de Crédito/i.test(body),
          hasCupo: /cupo|disponible|utilizado/i.test(body),
          hasMovements: /movimientos|Fecha.*Monto/i.test(body),
        };
      });

      if (pageText.hasCard || pageText.hasCupo || pageText.hasMovements) {
        debugLog.push(
          `TC: Direct URL navigation OK (card=${pageText.hasCard}, cupo=${pageText.hasCupo}, mov=${pageText.hasMovements})`
        );
        return true;
      }
      debugLog.push(`TC: Page loaded but no TC content detected yet`);
    } catch (e) {
      debugLog.push(`TC: Direct URL attempt ${attempt} failed: ${(e as Error).message}`);
    }
    await delay(2000);
  }

  // Fallback: click through sidebar menus
  debugLog.push("TC: Trying sidebar menu navigation...");
  const clickByText = async (text: string, exact = true): Promise<boolean> => {
    return await page.evaluate(
      ([searchText, isExact]) => {
        const items = document.querySelectorAll("div, span, a, li, button");
        for (const item of items) {
          const el = item as HTMLElement;
          const directText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim())
            .join("")
            .trim();
          const fullText = el.innerText?.trim() || "";
          const candidate = isExact ? directText : fullText;
          if (isExact ? candidate === searchText : candidate.includes(searchText)) {
            el.click();
            return true;
          }
        }
        return false;
      },
      [text, exact] as [string, boolean]
    );
  };

  // Navigate to home first
  try {
    await page.goto("https://portalpersonas.bice.cl/home", {
      waitUntil: "networkidle2",
      timeout: 15000,
    });
    await delay(3000);
  } catch {
    /* ignore */
  }

  // Click "Tarjetas de Crédito" sidebar item
  if (!(await clickByText("Tarjetas de Crédito"))) {
    debugLog.push("TC: 'Tarjetas de Crédito' not found in sidebar");
    return false;
  }
  await delay(2000);

  // Click "Consultas" submenu
  if (!(await clickByText("Consultas"))) {
    debugLog.push("TC: 'Consultas' not found in submenu");
    return false;
  }
  await delay(1000);

  // Click "Saldos y movimientos de Tarjeta de Crédito"
  if (!(await clickByText("Saldos y movimientos", false))) {
    debugLog.push("TC: 'Saldos y movimientos' link not found");
    return false;
  }
  await delay(5000);

  debugLog.push("TC: Menu navigation OK");
  return true;
}

export async function clickTcTab(page: Page, tabText: string): Promise<boolean> {
  const clicked = await page.evaluate((text) => {
    const items = document.querySelectorAll("div, button, span");
    for (const item of items) {
      const el = item as HTMLElement;
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE || (n as HTMLElement).children?.length === 0)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (directText.includes(text)) {
        el.click();
        return true;
      }
    }
    return false;
  }, tabText);

  if (clicked) await delay(3000);
  return clicked;
}

export async function clickBilledPeriod(page: Page, periodIndex: number): Promise<boolean> {
  const clicked = await page.evaluate((idx) => {
    const buttons = document.querySelectorAll('button[role="tab"], button');
    const periodButtons = Array.from(buttons).filter((btn) => {
      const text = (btn as HTMLElement).innerText?.trim() || "";
      return text.includes("Periodo de facturación");
    });
    if (idx >= periodButtons.length) return false;
    (periodButtons[idx] as HTMLElement).click();
    return true;
  }, periodIndex);

  if (clicked) await delay(3000);
  return clicked;
}
