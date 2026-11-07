import type { Page } from "puppeteer-core";
import type { BankMovement } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import { parseCencosudMovements } from "./parse.js";
import { selectTab } from "./navigation.js";

/**
 * Extract movements from the current page of the Cencosud movements table.
 * Detects the "Monto original" column dynamically from the thead so it works
 * for both the unbilled table (col 4) and the billed table (col 2).
 * Signs: positive page values = purchase (stored as negative), negative = credit/refund (positive).
 */
export async function extractOnePage(
  page: Page,
  source: BankMovement["source"]
): Promise<BankMovement[]> {
  // Wait for any row-like structure to appear before extracting
  await Promise.race([
    page
      .waitForSelector("table tr, [role='row'], [role='grid']", { timeout: 6000 })
      .catch(() => {}),
    delay(6000),
  ]);
  await delay(500);

  const raw = await page.evaluate((src: string) => {
    const DATE_RE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;
    type RawMov = {
      date: string;
      description: string;
      amount: number;
      installments?: string;
      source: string;
    };

    const findAmtIdx = (headers: string[]): number => {
      for (let i = headers.length - 1; i >= 0; i--) {
        if (headers[i].includes("monto original")) return i;
      }
      return headers.length > 0 ? headers.length - 1 : -1;
    };

    const parseAmt = (text: string): { amount: number; isNeg: boolean } | null => {
      const isNeg = text.includes("-");
      const clean = text.replace(/\./g, "").replace(/[^\d]/g, "");
      const n = parseInt(clean, 10);
      return isNaN(n) || n === 0 ? null : { amount: isNeg ? n : -n, isNeg };
    };

    const movements: RawMov[] = [];

    // ── Strategy 1: real <table> (with or without <tbody>) ──────────
    for (const table of Array.from(document.querySelectorAll("table"))) {
      const headerEls = table.querySelectorAll("thead th, thead td");
      const headers = Array.from(headerEls).map(
        (h) => (h as HTMLElement).innerText?.trim().toLowerCase() || ""
      );
      const amtIdx = findAmtIdx(headers);
      const cuotasIdx = headers.findIndex((h) => h.includes("cuota"));

      const dataRows = Array.from(table.querySelectorAll("tbody tr, tr")).filter(
        (r) => r.querySelectorAll("td").length >= 3
      );
      for (const row of dataRows) {
        const texts = Array.from(row.querySelectorAll("td")).map(
          (c) => (c as HTMLElement).innerText?.trim() || ""
        );
        const dateRaw = texts[0];
        const desc = texts[1] || "";
        if (!DATE_RE.test(dateRaw) || !desc.trim()) continue;
        const amtRaw =
          texts[amtIdx >= 0 && amtIdx < texts.length ? amtIdx : texts.length - 1] || "";
        const parsed = parseAmt(amtRaw);
        if (!parsed) continue;
        const installRaw = cuotasIdx >= 0 && cuotasIdx < texts.length ? texts[cuotasIdx] : "";
        const installments = /\d+\s*[Cc]uotas?|\d+\/\d+/.test(installRaw) ? installRaw : undefined;
        movements.push({
          date: dateRaw,
          description: desc,
          amount: parsed.amount,
          installments,
          source: src,
        });
      }
      if (movements.length > 0) return movements;
    }

    // ── Strategy 2: ARIA role="row" / role="gridcell" ───────────────
    const ariaRows = Array.from(document.querySelectorAll("[role='row']")).filter(
      (r) => r.querySelectorAll("[role='cell'], [role='gridcell']").length >= 3
    );
    if (ariaRows.length > 0) {
      const headers = Array.from(document.querySelectorAll("[role='columnheader']")).map(
        (h) => (h as HTMLElement).innerText?.trim().toLowerCase() || ""
      );
      const amtIdx = findAmtIdx(headers);
      const cuotasIdx = headers.findIndex((h) => h.includes("cuota"));
      for (const row of ariaRows) {
        const texts = Array.from(row.querySelectorAll("[role='cell'], [role='gridcell']")).map(
          (c) => (c as HTMLElement).innerText?.trim() || ""
        );
        const dateRaw = texts[0];
        const desc = texts[1] || "";
        if (!DATE_RE.test(dateRaw) || !desc.trim()) continue;
        const amtRaw =
          texts[amtIdx >= 0 && amtIdx < texts.length ? amtIdx : texts.length - 1] || "";
        const parsed = parseAmt(amtRaw);
        if (!parsed) continue;
        const installRaw = cuotasIdx >= 0 && cuotasIdx < texts.length ? texts[cuotasIdx] : "";
        const installments = /\d+\s*[Cc]uotas?|\d+\/\d+/.test(installRaw) ? installRaw : undefined;
        movements.push({
          date: dateRaw,
          description: desc,
          amount: parsed.amount,
          installments,
          source: src,
        });
      }
      if (movements.length > 0) return movements;
    }

    // ── Strategy 3: div grid — deepest element with date + amount ───
    const NOISE =
      /(ver todos|movimientos no facturados|movimientos facturados|nacionales|internacionales|fecha|operaci)/i;
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetParent === null) continue;
      const text = htmlEl.innerText?.trim() || "";
      if (text.length < 8 || text.length > 250) continue;
      const dateMatch = text.match(DATE_RE);
      if (!dateMatch) continue;
      const amtMatch = text.match(/\$\s*([\d.]{3,})/);
      if (!amtMatch) continue;
      if (NOISE.test(text)) continue;
      // Skip if any child also has both patterns (not the leaf)
      const childHasBoth = Array.from(htmlEl.children).some((c) => {
        const ct = (c as HTMLElement).innerText?.trim() || "";
        return DATE_RE.test(ct) && /\$\s*[\d.]{3,}/.test(ct);
      });
      if (childHasBoth) continue;
      // "+$" before amount = credit/refund (store positive); otherwise = purchase (store negative)
      const isCredit = /\+\s*\$/.test(text);
      const absAmt = parseInt(amtMatch[1].replace(/\./g, ""), 10);
      if (isNaN(absAmt) || absAmt === 0) continue;
      // Clean description: strip date, all $amounts, interest-rate percentages, trailing sign
      let desc = text
        .replace(dateMatch[0], "")
        .replace(/\$[\d.]+/g, "")
        .replace(/\b\d+[,.]\d+%/g, "")
        .replace(/\s+[+-]\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      // Extract installments ("3 Cuotas", "Cuota 01/01") from description
      const installMatch = desc.match(/\b(\d+\s+[Cc]uotas?|[Cc]uota\s+\d+\/\d+)\b/);
      const installments = installMatch ? installMatch[0] : undefined;
      if (installments) desc = desc.replace(installments, "").replace(/\s+/g, " ").trim();
      movements.push({
        date: dateMatch[1],
        description: desc,
        amount: isCredit ? absAmt : -absAmt,
        installments,
        source: src,
      });
    }

    return movements;
  }, source);

  return parseCencosudMovements(raw, source);
}

/**
 * Click the "next page" button in the Cencosud paginator.
 * Returns true if a next page exists and was clicked.
 */
async function clickNextPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Look for a right-arrow / "siguiente" button that is enabled
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
    for (const el of candidates) {
      const text = (el as HTMLElement).innerText?.trim() || "";
      const label = (el as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";
      const isNext =
        text === "›" ||
        text === ">" ||
        text === "→" ||
        label.includes("siguiente") ||
        label.includes("next") ||
        (el as HTMLElement).className?.toLowerCase().includes("next");
      if (!isNext) continue;
      if (
        (el as HTMLButtonElement).disabled ||
        (el as HTMLElement).getAttribute("aria-disabled") === "true"
      )
        return false;
      (el as HTMLElement).click();
      return true;
    }
    return false;
  });
}

/**
 * Extract ALL movements from a table section, paginating until no more pages.
 */
export async function extractTableMovements(
  page: Page,
  source: BankMovement["source"],
  debugLog: DebugLog
): Promise<BankMovement[]> {
  // Diagnostics: log what table-like structures exist on the page
  const diag = await page.evaluate(() => ({
    tables: document.querySelectorAll("table").length,
    trs: document.querySelectorAll("tr").length,
    tds: document.querySelectorAll("td").length,
    ariaRows: document.querySelectorAll("[role='row']").length,
    ariaGridcells: document.querySelectorAll("[role='gridcell'], [role='cell']").length,
    ariaGrid: document.querySelectorAll("[role='grid'], [role='table']").length,
  }));
  debugLog.push(
    `    DOM: tables=${diag.tables} tr=${diag.trs} td=${diag.tds} role=row:${diag.ariaRows} gridcell:${diag.ariaGridcells} grid:${diag.ariaGrid}`
  );

  const all: BankMovement[] = [];
  for (let pageNum = 1; pageNum <= 30; pageNum++) {
    const batch = await extractOnePage(page, source);
    debugLog.push(`    page ${pageNum}: ${batch.length} rows`);
    all.push(...batch);
    const hasNext = await clickNextPage(page);
    if (!hasNext) break;
    await delay(2000);
  }
  return all;
}

/**
 * Extract the "Mis Productos" balance card from the post-login dashboard.
 * Returns { used, available, total } from "Línea de compras / Avances", or null if not found.
 */
export async function extractDashboardBalance(
  page: Page
): Promise<{ used: number; available: number; total: number } | null> {
  return page.evaluate(() => {
    // Find the smallest visible container that has all three labels
    const all = Array.from(document.querySelectorAll("*")) as HTMLElement[];
    const containers = all.filter((el) => {
      if (el.offsetParent === null) return false;
      const t = el.innerText?.toLowerCase() || "";
      return t.includes("utilizado") && t.includes("disponible") && t.includes("cupo total");
    });
    if (containers.length === 0) return null;

    // Prefer the most specific (fewest children)
    const container = containers.sort(
      (a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length
    )[0];

    const text = container.innerText || "";
    const lower = text.toLowerCase();

    // For each label, grab the first $amount that appears after it in the text
    const getAmtAfter = (label: string): number => {
      const pos = lower.indexOf(label);
      if (pos < 0) return 0;
      const m = text.slice(pos).match(/\$([\d.]+)/);
      return m ? parseInt(m[1].replace(/\./g, ""), 10) : 0;
    };

    const used = getAmtAfter("utilizado");
    const available = getAmtAfter("disponible");
    const total = getAmtAfter("cupo total");
    return used || available || total ? { used, available, total } : null;
  });
}

/**
 * Extract the card label from the movements page header.
 * The header shows: "Mastercard Black ●●●● 7779"
 */
export async function extractCardLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Look for masked card number pattern next to a card brand name
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      const text = (el as HTMLElement).innerText?.trim() || "";
      // Pattern: "Mastercard Black ●●●● 7779" or "Visa ●●●● 1234"
      if (/[●•*]{2,}\s*\d{4}/.test(text) && text.length < 50 && el.children.length <= 2) {
        return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    return "Tarjeta Cencosud";
  });
}

/**
 * Extract movements for a given tab (Nacionales / Internacionales).
 * Clicks the tab first, waits for content, then extracts all pages.
 */
export async function extractTabMovements(
  page: Page,
  tabText: string,
  source: BankMovement["source"],
  debugLog: DebugLog
): Promise<BankMovement[]> {
  await selectTab(page, tabText, debugLog);
  return extractTableMovements(page, source, debugLog);
}
