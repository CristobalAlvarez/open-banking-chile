import type { Page } from "puppeteer-core";
import type { BankMovement, CreditCardBalance, MovementSource } from "../../core/types.js";
import type { DebugLog } from "../../core/debug-log.js";
import type { RawCreditCardInfo } from "./parse.js";
import {
  parseCreditCardInfo,
  parseCurrentMonthMovements,
  parseHistoricalMovements,
  parseTcMovements,
} from "./parse.js";

/** Saldo de la cabecera del dashboard (`h2.cabeceraCard2`). */
export async function extractAccountBalance(page: Page): Promise<number | undefined> {
  return await page.evaluate(() => {
    const el = document.querySelector("h2.cabeceraCard2");
    if (!el) return undefined;
    const text = (el as HTMLElement).innerText?.trim();
    if (!text) return undefined;
    const val = parseInt(text.replace(/[^0-9]/g, ""), 10);
    return isNaN(val) ? undefined : val;
  });
}

export async function extractCurrentMonthMovements(page: Page): Promise<BankMovement[]> {
  const raw = await page.evaluate(() => {
    const rows = document.querySelectorAll("div.transaction-table__container table tbody tr");
    const results: Array<{ date: string; category: string; description: string; amount: string }> =
      [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 4) continue;
      results.push({
        date: (cells[0] as HTMLElement).innerText?.trim() || "",
        category: (cells[1] as HTMLElement).innerText?.trim().toLowerCase() || "",
        description: (cells[2] as HTMLElement).innerText?.trim() || "",
        amount: (cells[3] as HTMLElement).innerText?.trim() || "",
      });
    }
    return results;
  });

  return parseCurrentMonthMovements(raw);
}

export async function extractHistoricalMovements(
  page: Page,
  debugLog: DebugLog
): Promise<BankMovement[]> {
  const raw = await page.evaluate(() => {
    const table =
      document.querySelector('table[aria-describedby="Tabla resumen de cartolas"]') ||
      document.querySelector("lib-credits-and-charges table") ||
      document.querySelector("ds-table table");
    if (!table)
      return {
        rows: [] as Array<{ date: string; category: string; description: string; amount: string }>,
        found: false,
      };

    const rows = table.querySelectorAll("tbody tr");
    const results: Array<{ date: string; category: string; description: string; amount: string }> =
      [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 5) continue;
      results.push({
        date: (cells[0] as HTMLElement).innerText?.trim() || "",
        category: (cells[1] as HTMLElement).innerText?.trim().toLowerCase() || "",
        description: (cells[3] as HTMLElement).innerText?.trim() || "",
        amount: (cells[4] as HTMLElement).innerText?.trim() || "",
      });
    }
    return { rows: results, found: true };
  });

  if (!raw.found) {
    debugLog.push("  Historical table not found");
    return [];
  }

  return parseHistoricalMovements(raw.rows);
}

export async function extractCreditCardInfo(
  page: Page,
  debugLog: DebugLog
): Promise<{ balance?: CreditCardBalance; movements: BankMovement[] }> {
  const data: RawCreditCardInfo = await page.evaluate(() => {
    const result: {
      label?: string;
      nationalUsed?: number;
      nationalAvailable?: number;
      nationalTotal?: number;
      internationalUsed?: number;
      internationalAvailable?: number;
      internationalTotal?: number;
      billingPeriod?: string;
      nextBillingDate?: string;
    } = {};

    // Card label — use specific selectors: p.subheading.semibold + p.format-number
    const brandEl = document.querySelector("p.subheading.semibold");
    const numberEl = document.querySelector("p.format-number");
    if (brandEl && numberEl) {
      const brand = brandEl.textContent?.trim() || "";
      const last4 = numberEl.textContent?.trim() || "";
      result.label = `${brand}${last4}`;
    } else {
      // Fallback: look for Visa/Mastercard + 4 digits in a single element
      const allP = document.querySelectorAll("p");
      for (const p of allP) {
        const t = (p as HTMLElement).innerText?.trim() || "";
        if (/^(Visa|Mastercard|Amex)/i.test(t) && /\d{4}/.test(t) && t.length < 50) {
          result.label = t;
          break;
        }
      }
    }

    // Cupo info — extract from app-progression-chart elements (Nacional/Internacional)
    const parseAmount = (text: string): number | undefined => {
      const clean = text
        .replace(/[^0-9,.-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const num = parseFloat(clean);
      return isNaN(num) ? undefined : Math.round(num);
    };

    const charts = document.querySelectorAll("app-progression-chart");
    for (const chart of charts) {
      const title = chart.querySelector("h4.chart-title")?.textContent?.trim() || "";
      const allText = (chart as HTMLElement).innerText || "";

      // Extract "Cupo Total: $X" directly
      const totalMatch = allText.match(/Cupo Total:\s*(?:\$|US\$)?([\d.,]+)/i);
      // The layout is: "$10.122.582  Cupo utilizado $0  Cupo disponible"
      // We need the amount AFTER "Cupo utilizado" and "Cupo disponible"
      const usedMatch = allText.match(/Cupo utilizado\s*(?:\$|US\$)?\s*([\d.,]+)/i);
      const availMatch = allText.match(/Cupo disponible\s*(?:\$|US\$)?\s*([\d.,]+)/i);

      if (title === "Nacional") {
        if (usedMatch) result.nationalUsed = parseAmount(usedMatch[1]);
        if (availMatch) result.nationalAvailable = parseAmount(availMatch[1]);
        if (totalMatch) result.nationalTotal = parseAmount(totalMatch[1]);
      } else if (title === "Internacional") {
        if (usedMatch) result.internationalUsed = parseAmount(usedMatch[1]);
        if (availMatch) result.internationalAvailable = parseAmount(availMatch[1]);
        if (totalMatch) result.internationalTotal = parseAmount(totalMatch[1]);
      }
    }

    // Billing dates — from card-billing-info-container
    const allText = document.body.innerText || "";
    const billingMatch = allText.match(/Facturación:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    const dueMatch = allText.match(/Vencimiento:\s*(\d{1,2}\s+\w+\s+\d{4})/i);
    if (billingMatch) result.billingPeriod = billingMatch[1];
    if (dueMatch) result.nextBillingDate = dueMatch[1];

    return result;
  });

  const ccBalance = parseCreditCardInfo(data);

  debugLog.push(
    `TC: Card=${ccBalance.label}, Nacional used=${ccBalance.national?.used}, Intl used=${ccBalance.international?.used}`
  );

  return { balance: ccBalance, movements: [] };
}

export async function extractTcMovementsFromPage(
  page: Page,
  source: MovementSource
): Promise<BankMovement[]> {
  const raw = await page.evaluate(() => {
    const results: Array<{
      date: string;
      description: string;
      amount: string;
      installments: string;
    }> = [];

    // Use app-transaction-row elements (BICE's actual DOM structure)
    const rows = document.querySelectorAll("app-transaction-row");

    for (const row of rows) {
      // Date: div.date
      const dateEl = row.querySelector("div.date");
      const date = dateEl?.textContent?.trim() || "";
      if (!/^\d{1,2}\s/.test(date)) continue;

      // Description: div.transaction-detail
      const descEl = row.querySelector(
        "div.transaction-detail, div.transaction-detail.transaction-state"
      );
      const description = descEl?.textContent?.trim() || "";

      // Installments: div.transaction-installments
      const instEl = row.querySelector("div.transaction-installments");
      const installments = instEl?.textContent?.trim() || "";

      // Amount: span.transaction-amount
      const amtEl = row.querySelector("span.transaction-amount");
      const amount = amtEl?.textContent?.trim() || "";

      if (date && description && amount) {
        results.push({ date, description, amount, installments });
      }
    }

    return results;
  });

  return parseTcMovements(raw, source);
}
