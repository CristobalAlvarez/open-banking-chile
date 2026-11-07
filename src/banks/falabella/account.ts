import type { Page } from "playwright-core";
import type { DebugLog } from "../../core/debug-log.js";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import type { BankMovement } from "../../core/types.js";
import { parseAccountRows, parseAvailableBalance } from "./parse.js";

const MAX_PAGES = 20;

/** Extrae movimientos y saldo de la cartola ya abierta. */
export async function extractAccountData(
  page: Page,
  debugLog: DebugLog,
  progress: (s: string) => void
): Promise<{ movements: BankMovement[]; balance?: number }> {
  // Expand date range if possible
  await tryExpandDateRange(page, debugLog);

  // Extract movements via pagination
  progress("Extrayendo movimientos de cuenta...");
  const movements = await paginateAccountMovements(page, debugLog);
  debugLog.step(`[Cuenta] Extracted ${movements.length} movements`);
  progress(`Cuenta: ${movements.length} movimientos encontrados`);

  // Extract balance
  let balance: number | undefined;
  if (movements.length > 0 && movements[0].balance > 0) {
    balance = movements[0].balance;
  }
  if (balance === undefined) {
    const bodyText = await page
      .locator("body")
      .textContent()
      .catch(() => "");
    const parsedBalance = parseAvailableBalance(bodyText);
    if (parsedBalance !== undefined) balance = parsedBalance;
  }

  return { movements, balance };
}

async function tryExpandDateRange(page: Page, debugLog: DebugLog): Promise<void> {
  try {
    const selects = page.locator("select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const options = await sel.locator("option").allTextContents();
      for (const text of options) {
        const lower = text.toLowerCase();
        if (
          lower.includes("todos") ||
          lower.includes("último mes") ||
          lower.includes("30 día") ||
          lower.includes("mes anterior")
        ) {
          await sel.selectOption({ label: text });
          debugLog.push(`  Changed select to "${text}"`);
          await delay(3000);
          break;
        }
      }
    }
  } catch {
    /* best effort */
  }
}

export async function extractMovementsFromPage(page: Page): Promise<BankMovement[]> {
  return page
    .evaluate(() => {
      const results: Array<{
        date: string;
        description: string;
        amount: number;
        balance: number;
        source: string;
      }> = [];

      const tables = Array.from(document.querySelectorAll("table"));
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll("tr"));
        if (rows.length < 2) continue;

        // Find header row to determine column indices
        let dateIdx = 0,
          descIdx = 1,
          cargoIdx = -1,
          abonoIdx = -1,
          amountIdx = -1,
          balanceIdx = -1;
        let hasHeader = false;

        for (const row of rows) {
          const headers = row.querySelectorAll("th");
          if (headers.length < 2) continue;
          const hTexts = Array.from(headers).map(
            (h) => (h as HTMLElement).innerText?.trim().toLowerCase() || ""
          );
          if (!hTexts.some((h) => h.includes("fecha"))) continue;
          hasHeader = true;
          dateIdx = hTexts.findIndex((h) => h.includes("fecha"));
          descIdx = hTexts.findIndex(
            (h) => h.includes("descrip") || h.includes("detalle") || h.includes("glosa")
          );
          cargoIdx = hTexts.findIndex((h) => h.includes("cargo") || h.includes("débito"));
          abonoIdx = hTexts.findIndex((h) => h.includes("abono") || h.includes("crédito"));
          amountIdx = hTexts.findIndex((h) => h === "monto" || h.includes("importe"));
          balanceIdx = hTexts.findIndex((h) => h.includes("saldo"));
          break;
        }
        if (!hasHeader) continue;

        let lastDate = "";
        for (const row of rows) {
          const cells = row.querySelectorAll("td");
          if (cells.length < 3) continue;
          const vals = Array.from(cells).map((c) => (c as HTMLElement).innerText?.trim() || "");
          const rawDate = vals[dateIdx] || "";
          const hasDate = /^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(rawDate);
          const date = hasDate ? rawDate : lastDate;
          if (!date) continue;
          if (hasDate) lastDate = rawDate;

          const description = descIdx >= 0 ? vals[descIdx] || "" : "";
          let amountStr = "";
          if (cargoIdx >= 0 && vals[cargoIdx]?.replace(/\s/g, "")) {
            amountStr = `-${vals[cargoIdx]}`;
          } else if (abonoIdx >= 0 && vals[abonoIdx]?.replace(/\s/g, "")) {
            amountStr = vals[abonoIdx];
          } else if (amountIdx >= 0) {
            amountStr = vals[amountIdx] || "";
          }
          if (!amountStr) continue;

          const balStr = balanceIdx >= 0 ? vals[balanceIdx] || "" : "";

          // Parse amounts inline (can't call external functions inside evaluate)
          function parseCLP(text: string): number {
            const clean = text.replace(/[^0-9.,-]/g, "");
            if (!clean) return 0;
            const isNeg = clean.startsWith("-") || text.includes("-$");
            const norm = clean.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
            const val = parseInt(norm, 10) || 0;
            return isNeg ? -val : val;
          }

          results.push({
            date,
            description,
            amount: parseCLP(amountStr),
            balance: parseCLP(balStr),
            source: "account",
          });
        }
      }
      return results;
    })
    .then((raw) => parseAccountRows(raw));
}

async function paginateAccountMovements(page: Page, debugLog: DebugLog): Promise<BankMovement[]> {
  const all: BankMovement[] = [];

  for (let i = 0; i < MAX_PAGES; i++) {
    const movements = await extractMovementsFromPage(page);
    all.push(...movements);

    // Try clicking "Siguiente" or "Ver más"
    let clicked = false;
    for (const text of ["siguiente", "ver más", "mostrar más"]) {
      const btn = page
        .locator("button, a")
        .filter({ hasText: new RegExp(text, "i") })
        .first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        const disabled = await btn.isDisabled().catch(() => true);
        if (!disabled) {
          await btn.click();
          await delay(2500);
          clicked = true;
          debugLog.push(`  Pagination: loaded page ${i + 2}`);
          break;
        }
      }
    }
    if (!clicked) break;
  }

  return deduplicateMovements(all);
}
