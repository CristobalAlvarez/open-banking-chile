import type { Page } from "puppeteer-core";
import type { BankMovement } from "../../core/types.js";
import { allDeepJs } from "./deep-dom.js";
import { normalizeScotiabankMovements, parseBalanceText } from "./parse.js";
import type { RawScotiabankMovement } from "./parse.js";

/**
 * Lee las filas crudas de movimientos desde un contexto (página o frame) atravesando
 * Shadow DOM. Devuelve los textos tal cual: la normalización pura vive en `parse.ts`.
 */
export async function extractRawMovements(context: {
  evaluate: Page["evaluate"];
}): Promise<RawScotiabankMovement[]> {
  const raw = await context.evaluate(
    new Function(`${allDeepJs()}
        const results = [];
        const tables = allDeep(document, "table");
        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll("tr"));
          if (rows.length < 2) continue;
          let dateIndex = 0, descriptionIndex = 1, cargoIndex = -1, abonoIndex = -1, amountIndex = -1, balanceIndex = -1, hasHeader = false;
          for (const row of rows) {
            const headers = row.querySelectorAll("th");
            if (headers.length < 2) continue;
            const ht = Array.from(headers).map(h => h.innerText?.trim().toLowerCase() || "");
            if (!ht.some(h => h.includes("fecha"))) continue;
            hasHeader = true;
            dateIndex = ht.findIndex(h => h.includes("fecha"));
            descriptionIndex = ht.findIndex(h => h.includes("descrip") || h.includes("detalle") || h.includes("glosa"));
            cargoIndex = ht.findIndex(h => h.includes("cargo") || h.includes("débito") || h.includes("debito"));
            abonoIndex = ht.findIndex(h => h.includes("abono") || h.includes("crédito") || h.includes("credito"));
            amountIndex = ht.findIndex(h => h === "monto" || h.includes("importe"));
            balanceIndex = ht.findIndex(h => h.includes("saldo"));
            break;
          }
          if (!hasHeader) continue;
          let lastDate = "";
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length < 3) continue;
            const values = Array.from(cells).map(c => c.innerText?.trim() || "");
            const rawDate = values[dateIndex] || "";
            const hasDate = /^\\d{1,2}[\\/.-]\\d{1,2}([\\/.-]\\d{2,4})?$/.test(rawDate);
            const date = hasDate ? rawDate : lastDate;
            if (!date) continue;
            if (hasDate) lastDate = rawDate;
            const description = descriptionIndex >= 0 ? (values[descriptionIndex] || "") : "";
            let amount = "";
            if (cargoIndex >= 0 && values[cargoIndex]) amount = "-" + values[cargoIndex];
            else if (abonoIndex >= 0 && values[abonoIndex]) amount = values[abonoIndex];
            else if (amountIndex >= 0) amount = values[amountIndex] || "";
            const balance = balanceIndex >= 0 ? (values[balanceIndex] || "") : "";
            if (!amount) continue;
            results.push({ date, description, amount, balance });
          }
        }
        if (results.length === 0) {
          const cards = allDeep(document, "[class*='mov'], [class*='tran'], [class*='transaction'], li, article");
          for (const card of cards) {
            const text = card.innerText || "";
            const lines = text.split("\\n").map(l => l.trim()).filter(Boolean);
            if (lines.length < 3 || lines.length > 10) continue;
            const date = lines.find(l => /\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}/.test(l));
            const amount = lines.find(l => /[$]\\s*[\\d.]+/.test(l));
            if (!date || !amount) continue;
            const description = lines.find(l => l !== date && l !== amount && l.length > 3) || "";
            const balance = lines.find(l => l.toLowerCase().includes("saldo") && /[$]\\s*[\\d.]+/.test(l)) || "";
            const isCargo = text.toLowerCase().includes("cargo") || text.toLowerCase().includes("débito") || amount.includes("-");
            results.push({ date, description, amount: isCargo ? (amount.startsWith("-") ? amount : "-" + amount) : amount, balance });
          }
        }
        return results;`) as () => Array<{
      date: string;
      description: string;
      amount: string;
      balance: string;
    }>
  );
  return raw;
}

export async function extractMovements(page: Page): Promise<BankMovement[]> {
  // Extract from page + all frames (piercing Shadow DOM)
  const contexts: Array<{ evaluate: Page["evaluate"] }> = [page];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) contexts.push(frame);
  }

  const allRaw: RawScotiabankMovement[] = [];
  for (const ctx of contexts) {
    try {
      const raw = await extractRawMovements(ctx);
      allRaw.push(...raw);
    } catch {
      /* detached frame */
    }
  }

  return normalizeScotiabankMovements(allRaw);
}

/** Lee el saldo desde el texto visible de la página; `undefined` si no hay un patrón conocido. */
export async function extractBalance(page: Page): Promise<number | undefined> {
  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  return parseBalanceText(bodyText);
}
