import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import { parseChileanAmount } from "../../core/parsing.js";
import type { BankMovement } from "../../core/types.js";
import { clickNextPage } from "./navigation.js";
import type { RawMovement } from "./parse.js";
import { parseRawMovements } from "./parse.js";

/** Lee el saldo de CuentaRUT en el dashboard (tarjetas de producto o texto de la página). */
export async function extractBalanceFromDashboard(
  page: Page,
  debugLog: DebugLog
): Promise<number | undefined> {
  const balance = await page.evaluate(() => {
    const productCards = document.querySelectorAll(
      '[class*="product"], [class*="card"], [class*="cuenta"]'
    );
    for (const card of productCards) {
      const text = (card as HTMLElement).innerText || "";
      if (text.toLowerCase().includes("cuentarut") || text.toLowerCase().includes("cuenta rut")) {
        const amountMatch = text.match(/\$\s*([\d.,]+)/);
        if (amountMatch) return amountMatch[1];
      }
    }
    const bodyText = document.body?.innerText || "";
    const patterns = [
      /cuentarut[^$]*\$\s*([\d.,]+)/i,
      /cuenta\s*rut[^$]*\$\s*([\d.,]+)/i,
      /saldo\s*disponible[:\s]*\$?\s*([\d.,]+)/i,
    ];
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return match[1];
    }
    return null;
  });

  if (balance) {
    const parsed = parseChileanAmount(balance);
    debugLog.push(`  CuentaRUT balance: $${parsed.toLocaleString("es-CL")}`);
    return parsed;
  }
  return undefined;
}

/** Lee las filas crudas de movimientos: primero la tabla con encabezados, si no las tarjetas. */
export async function extractRawMovements(page: Page): Promise<RawMovement[]> {
  return page.evaluate(() => {
    const results: Array<{ date: string; description: string; amount: string; balance: string }> =
      [];

    // Strategy 1: Table with headers
    const tables = document.querySelectorAll("table");
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length < 2) continue;

      let dateIdx = -1,
        descIdx = -1,
        amountIdx = -1,
        saldoIdx = -1;
      let cargoIdx = -1,
        abonoIdx = -1;
      for (const row of rows) {
        const ths = row.querySelectorAll("th");
        if (ths.length >= 3) {
          const headers = Array.from(ths).map((h) =>
            (h as HTMLElement).innerText?.trim().toLowerCase()
          );
          dateIdx = headers.findIndex((h) => h.includes("fecha"));
          descIdx = headers.findIndex(
            (h) => h.includes("descripci") || h.includes("detalle") || h.includes("glosa")
          );
          saldoIdx = headers.findIndex((h) => h.includes("saldo"));
          amountIdx = headers.findIndex(
            (h) =>
              (h.includes("abono") && h.includes("cargo")) ||
              h.includes("monto") ||
              h.includes("importe")
          );
          if (amountIdx < 0) {
            cargoIdx = headers.findIndex(
              (h) => h === "cargo" || h === "cargos" || h.includes("débito")
            );
            abonoIdx = headers.findIndex(
              (h) =>
                h === "abono" || h === "abonos" || h.includes("crédito") || h.includes("depósito")
            );
          }
          if (dateIdx >= 0) break;
        }
      }

      if (dateIdx < 0) continue;

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 3) continue;
        const texts = Array.from(cells).map((c) => (c as HTMLElement).innerText?.trim());
        const dateText = texts[dateIdx] || "";
        if (!/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(dateText)) continue;

        let amount = "";
        if (amountIdx >= 0) {
          amount = texts[amountIdx] || "";
        } else if (cargoIdx >= 0 || abonoIdx >= 0) {
          const cargo = cargoIdx >= 0 ? texts[cargoIdx] || "" : "";
          const abono = abonoIdx >= 0 ? texts[abonoIdx] || "" : "";
          if (cargo && cargo !== "$0" && cargo !== "0") amount = `-${cargo}`;
          else if (abono) amount = abono;
        }

        results.push({
          date: dateText,
          description: texts[descIdx >= 0 ? descIdx : 1] || "",
          amount,
          balance: saldoIdx >= 0 ? texts[saldoIdx] || "" : "",
        });
      }
    }

    // Strategy 2: Dashboard movement cards
    if (results.length === 0) {
      const movRows = document.querySelectorAll(
        '[class*="movimiento"], [class*="movement"], [class*="transaction"]'
      );
      for (const el of movRows) {
        const text = (el as HTMLElement).innerText || "";
        const dateMatch = text.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
        const amountMatch = text.match(/[+-]?\$[\d.,]+/g);
        if (dateMatch && amountMatch) {
          const lines = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          const descLine = lines.find(
            (l) => !l.match(/^[+-]?\$/) && !l.match(/^\d{1,2}[/.-]/) && l.length > 2
          );
          results.push({
            date: dateMatch[1],
            description: descLine || "",
            amount: amountMatch[0],
            balance: amountMatch.length > 1 ? amountMatch[amountMatch.length - 1] : "",
          });
        }
      }
    }

    return results;
  });
}

/** Extrae los movimientos de la página actual y avanza el paginador hasta agotarlo. */
export async function collectMovements(page: Page, debugLog: DebugLog): Promise<BankMovement[]> {
  let movements = parseRawMovements(await extractRawMovements(page));

  for (let i = 0; i < 10; i++) {
    const hasMore = await clickNextPage(page);
    if (!hasMore) break;
    debugLog.push(`  Pagination: page ${i + 2}`);
    await delay(3000);
    const more = parseRawMovements(await extractRawMovements(page));
    if (more.length === 0) break;
    movements.push(...more);
  }

  return movements;
}
