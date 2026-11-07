import type { Page } from "playwright-core";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import type { BankMovement, MovementSource } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { parseCmrRows } from "./parse.js";

const MAX_PAGES = 20;

export async function paginateCmrMovements(
  page: Page,
  source: MovementSource,
  debugLog: string[]
): Promise<BankMovement[]> {
  const all: BankMovement[] = [];
  const host = "credit-card-movements";

  for (let i = 0; i < MAX_PAGES; i++) {
    // Extract + click next in a single evaluate
    const result: { rows: BankMovement[]; firstRow: string; clicked: boolean } =
      await page.evaluate(
        ({ host: h, src, isBilled }: { host: string; src: string; isBilled: boolean }) => {
          const shadowEl = document.querySelector(h) as Element & { shadowRoot?: ShadowRoot };
          const topRoot = shadowEl?.shadowRoot || document;

          function collectAll(root: ShadowRoot | Element | Document): Array<ShadowRoot | Element> {
            const found: Array<ShadowRoot | Element> = root instanceof Document ? [] : [root];
            for (const el of Array.from((root as ParentNode).querySelectorAll("*"))) {
              const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
              if (sr) found.push(...collectAll(sr));
            }
            return found;
          }
          const roots = collectAll(topRoot);

          // Extract movements from visible tables
          const allTables: HTMLTableElement[] = roots.flatMap((r) =>
            Array.from((r as Element).querySelectorAll<HTMLTableElement>("table"))
          );
          function isVisible(t: HTMLTableElement): boolean {
            const r = t.getBoundingClientRect();
            return r.width > 0 || r.height > 0;
          }

          const rows: BankMovement[] = [];
          const tablesToUse = isBilled
            ? allTables.filter((t) => {
                if (!isVisible(t)) return false;
                const hdr =
                  (
                    t.querySelector("thead, tr:first-child") as HTMLElement | null
                  )?.innerText?.toLowerCase() ?? "";
                return (
                  hdr.includes("fecha de compra") ||
                  hdr.includes("monto total") ||
                  hdr.includes("cuota a pagar")
                );
              })
            : allTables.filter((t) => isVisible(t));

          const finalTables =
            tablesToUse.length > 0
              ? tablesToUse
              : allTables.filter((t) => isVisible(t) && !t.closest("app-last-movements"));

          for (const table of finalTables) {
            for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
              const cells = row.querySelectorAll("td");
              if (cells.length < 4) continue;
              const texts = Array.from(cells).map(
                (c) => (c as HTMLElement).innerText?.trim() || ""
              );
              const dateMatch = texts[0]?.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
              const pendingImg = row.querySelector(
                "td:first-child img[alt*='pendiente'], td:first-child .td-time-img"
              );
              if (!dateMatch && !pendingImg && texts[0] !== "") continue;
              const date = dateMatch ? dateMatch[1].replace(/\//g, "-") : "pendiente";
              const description = texts[1] || "";
              const totalText = texts[3] || "";
              const cuotaText = texts[5] || "";
              const montoText = cuotaText || totalText;
              const isNeg = montoText.includes("-$");
              const amountMatch = montoText.match(/\$\s*([\d.,]+)/);
              let amount = 0;
              if (amountMatch) {
                const value =
                  parseInt(amountMatch[1].replace(/\./g, "").replace(",", "."), 10) || 0;
                amount = isNeg ? value : -value;
              }
              const totalAmountMatch = totalText.match(/\$\s*([\d.,]+)/);
              const totalAmount = totalAmountMatch
                ? parseInt(totalAmountMatch[1].replace(/\./g, "").replace(",", "."), 10) ||
                  undefined
                : undefined;
              if (description && amount !== 0) {
                rows.push({
                  date,
                  description,
                  amount,
                  balance: 0,
                  source: src as MovementSource,
                  owner: (texts[2] || undefined) as any,
                  installments: texts[4] || undefined,
                  totalAmount,
                });
              }
            }
          }

          // First row signature for change detection.
          // For billed movements, prefer the "fecha de compra" table — "pendientes de
          // confirmación" rows don't change across pages and cause false negatives.
          let firstRow = "";
          if (isBilled) {
            outer: for (const r of roots) {
              for (const tbl of Array.from(
                (r as Element).querySelectorAll<HTMLTableElement>("table")
              )) {
                const hdr =
                  (
                    tbl.querySelector("thead, tr:first-child") as HTMLElement | null
                  )?.innerText?.toLowerCase() ?? "";
                if (!hdr.includes("fecha de compra")) continue;
                const cells = tbl.querySelectorAll("tbody tr:first-child td");
                if (cells.length > 0) {
                  firstRow = Array.from(cells)
                    .map((c) => (c as HTMLElement).innerText?.trim())
                    .join("|");
                  break outer;
                }
              }
            }
          }
          if (!firstRow) {
            for (const r of roots) {
              const cells = (r as Element).querySelectorAll("table tbody tr:first-child td");
              if (cells.length > 0) {
                firstRow = Array.from(cells)
                  .map((c) => (c as HTMLElement).innerText?.trim())
                  .join("|");
                break;
              }
            }
          }

          // Click next button
          let clicked = false;
          for (const root of roots) {
            if (clicked) break;
            for (const btn of Array.from(
              (root as Element).querySelectorAll<HTMLButtonElement>(".btn-pagination, button")
            )) {
              if (btn.disabled) continue;
              const img = btn.querySelector("img");
              const imgAlt = (img?.getAttribute("alt") || "").toLowerCase();
              const imgSrc = img?.getAttribute("src") || "";
              const label = (btn.getAttribute("aria-label") || btn.innerText || "").toLowerCase();
              const isNext =
                imgAlt.includes("avanzar") ||
                imgAlt.includes("siguiente") ||
                imgAlt.includes("next") ||
                imgSrc.includes("right-arrow") ||
                imgSrc.includes("arrow-right") ||
                imgSrc.includes("next") ||
                label.includes("siguiente") ||
                label.includes("next") ||
                label.includes("avanzar");
              if (isNext) {
                btn.click();
                clicked = true;
                break;
              }
            }
          }

          return { rows, firstRow, clicked };
        },
        { host, src: source, isBilled: source === MOVEMENT_SOURCE.credit_card_billed }
      );

    debugLog.push(`  [CMR pag] page ${i + 1}: ${result.rows.length} rows`);
    all.push(...result.rows);

    if (!result.clicked) break;

    // Wait for content to change — use the same "fecha de compra" preference as above
    const prevRow = result.firstRow;
    const isBilled = source === MOVEMENT_SOURCE.credit_card_billed;
    const changed = await page
      .waitForFunction(
        ({ host: h, prev, billed }: { host: string; prev: string; billed: boolean }) => {
          const el = document.querySelector(h) as Element & { shadowRoot?: ShadowRoot };
          const topRoot = el?.shadowRoot || document;
          function collectAll(root: ShadowRoot | Element | Document): Array<ShadowRoot | Element> {
            const found: Array<ShadowRoot | Element> = root instanceof Document ? [] : [root];
            for (const child of Array.from((root as ParentNode).querySelectorAll("*"))) {
              const sr = (child as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
              if (sr) found.push(...collectAll(sr));
            }
            return found;
          }
          const roots = collectAll(topRoot);
          // Prefer "fecha de compra" table for billed to avoid false negatives
          if (billed) {
            for (const r of roots) {
              for (const tbl of Array.from(
                (r as Element).querySelectorAll<HTMLTableElement>("table")
              )) {
                const hdr =
                  (
                    tbl.querySelector("thead, tr:first-child") as HTMLElement | null
                  )?.innerText?.toLowerCase() ?? "";
                if (!hdr.includes("fecha de compra")) continue;
                const cells = tbl.querySelectorAll("tbody tr:first-child td");
                if (cells.length > 0) {
                  const sig = Array.from(cells)
                    .map((c) => (c as HTMLElement).innerText?.trim())
                    .join("|");
                  return sig !== prev && sig !== "";
                }
              }
            }
          }
          // Fallback: any table's first row
          for (const root of roots) {
            const cells = (root as Element).querySelectorAll("table tbody tr:first-child td");
            if (cells.length > 0) {
              const sig = Array.from(cells)
                .map((c) => (c as HTMLElement).innerText?.trim())
                .join("|");
              return sig !== prev && sig !== "";
            }
          }
          return false;
        },
        { host, prev: prevRow, billed: isBilled },
        { timeout: 15000 }
      )
      .then(
        () => true,
        () => false
      );

    if (!changed) break;
    await delay(300);
  }

  return deduplicateMovements(parseCmrRows(all));
}
