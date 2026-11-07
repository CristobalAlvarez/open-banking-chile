import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import type { BankMovement } from "../../core/types.js";
import { parseTxtMovements } from "./parse.js";

export async function waitForDashboard(page: Page): Promise<void> {
  const start = Date.now();
  const keywords = [
    "cartola",
    "movimientos",
    "cuenta corriente",
    "mi cuenta",
    "saldo",
    "bienvenido",
  ];
  while (Date.now() - start < 20000) {
    const found = await page.evaluate((kws: string[]) => {
      const text = document.body?.innerText?.toLowerCase() || "";
      return kws.some((k) => text.includes(k));
    }, keywords);
    if (found) break;
    await delay(1500);
  }
}

/** Finds an element by visible text and clicks it with Puppeteer's native click (triggers real browser events). */
async function nativeClick(
  page: Page,
  texts: string[],
  selectors = "a, button, li, span, [role='menuitem']"
): Promise<string | null> {
  // First locate the element and get its bounding box
  const result = await page.evaluate(
    (txts: string[], sels: string) => {
      for (const el of Array.from(document.querySelectorAll(sels))) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
        if (
          txts.some((t) => text === t || text.includes(t)) &&
          text.length < 80 &&
          (el as HTMLElement).offsetParent !== null
        ) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          const href = (el as HTMLAnchorElement).href || null;
          return {
            text: (el as HTMLElement).innerText.trim().slice(0, 40),
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            href,
          };
        }
      }
      return null;
    },
    texts,
    selectors
  );
  if (!result) return null;
  // Navigate directly if it's a link, otherwise use native mouse click
  if (result.href && !result.href.startsWith("javascript")) {
    await page.goto(result.href, { waitUntil: "networkidle2", timeout: 30000 });
  } else {
    await page.mouse.click(result.x, result.y);
  }
  return result.text;
}

export async function navigateToMovements(page: Page, debugLog: DebugLog): Promise<void> {
  await waitForDashboard(page);

  // Step 1: open "Productos" in top nav (native click to trigger hover/dropdown)
  const clickedProductos = await nativeClick(page, ["productos"]);
  if (clickedProductos) {
    debugLog.push(`  Clicked: ${clickedProductos}`);
    await delay(1500);
  }

  // Step 2: click "Saldos y movimientos" (under Cuenta Corriente in the dropdown)
  const clicked = await nativeClick(page, ["saldos y movimientos"]);
  if (clicked) {
    debugLog.push(`  Clicked: ${clicked}`);
    await delay(5000);
    return;
  }

  // Fallback: try other movement-related links
  const fallbacks = [
    "movimientos",
    "últimos movimientos",
    "ver movimientos",
    "cartola histórica",
    "cartola",
  ];
  for (const target of fallbacks) {
    const c = await nativeClick(page, [target]);
    if (c) {
      debugLog.push(`  Clicked fallback: ${c}`);
      await delay(5000);
      return;
    }
  }

  debugLog.push("  (no movement link found)");
}

// ─── Historical months (Cartola histórica via TXT) ───────────────

const CARTOLA_URL = "https://www.bancosecurity.cl/Empresas/Cuentas/cartola_corriente.asp";

/**
 * Navigates to Cartola histórica, reads the month select options,
 * and fetches TXT content for up to `months` historical periods.
 */
export async function fetchHistoricalMonths(
  page: Page,
  months: number,
  debugLog: DebugLog
): Promise<BankMovement[]> {
  debugLog.push(`  Fetching up to ${months} historical month(s)...`);

  // Navigate to Cartola histórica via the Productos menu
  const clickedProductos = await nativeClick(page, ["productos"]);
  if (clickedProductos) await delay(1500);

  const clickedCartola = await nativeClick(page, ["cartola histórica", "cartola historica"]);
  if (clickedCartola) {
    debugLog.push(`  Clicked: ${clickedCartola}`);
    await delay(3000);
  } else {
    // Direct navigation as fallback
    await page.goto(CARTOLA_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await delay(2000);
  }

  // Find the frame containing select#fecha (content may be in an iframe)
  type FrameCtx = { evaluate: Page["evaluate"] };
  const allFrames: FrameCtx[] = [
    page,
    ...(page.frames().filter((f) => f !== page.mainFrame()) as unknown as FrameCtx[]),
  ];

  let cartolaFrame: FrameCtx | null = null;
  for (const ctx of allFrames) {
    const found: boolean = await ctx
      .evaluate(() => !!document.querySelector("#fecha"))
      .catch(() => false);
    if (found) {
      cartolaFrame = ctx;
      break;
    }
  }

  if (!cartolaFrame) {
    debugLog.push("  select#fecha not found in any frame — skipping historical");
    return [];
  }

  // Read available month options from select#fecha
  const options: Array<{ value: string; text: string }> = await cartolaFrame.evaluate(() => {
    const sel = document.querySelector("#fecha") as HTMLSelectElement | null;
    if (!sel) return [];
    return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text.trim() }));
  });
  // Skip placeholder "Seleccionar" and any option with no meaningful value
  const realOptions = options.filter((o) => o.value && o.text.toLowerCase() !== "seleccionar");
  debugLog.push(`  Available months: ${realOptions.map((o) => o.text).join(", ")}`);

  const all: BankMovement[] = [];
  const take = Math.min(months, realOptions.length);

  for (let i = 0; i < take; i++) {
    const opt = realOptions[i];
    debugLog.push(`  Fetching month: ${opt.text}`);

    // Set select value and click Consultar (in the same frame)
    await cartolaFrame.evaluate((val: string) => {
      const sel = document.querySelector("#fecha") as HTMLSelectElement | null;
      if (sel) sel.value = val;
    }, opt.value);
    await delay(300);

    const submitted: boolean = await cartolaFrame.evaluate(() => {
      const btn = document.querySelector("#buscar") as HTMLElement | null;
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    if (!submitted) {
      debugLog.push(`  Could not click Consultar for ${opt.text}`);
      continue;
    }

    // Poll for TXT link up to 8s instead of a fixed delay
    let txtHref: string | null = null;
    const deadline = Date.now() + 8000;
    while (!txtHref && Date.now() < deadline) {
      const searchContexts: FrameCtx[] = [
        cartolaFrame,
        ...(page.frames().filter((f) => f !== page.mainFrame()) as unknown as FrameCtx[]),
      ];
      for (const ctx of searchContexts) {
        txtHref = await ctx
          .evaluate(() => {
            for (const a of Array.from(document.querySelectorAll("a"))) {
              if (
                a.innerText?.trim().toUpperCase() === "TXT" &&
                (a as HTMLElement).offsetParent !== null
              )
                return a.href;
            }
            return null;
          })
          .catch(() => null);
        if (txtHref) break;
      }
      if (!txtHref) await delay(500);
    }

    if (!txtHref) {
      debugLog.push(`  No TXT link found for ${opt.text}`);
      continue;
    }

    const content: string = await cartolaFrame.evaluate(async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      return r.text();
    }, txtHref);

    const parsed = parseTxtMovements(content);
    debugLog.push(`  Parsed ${parsed.length} movements from ${opt.text}`);
    all.push(...parsed);
  }

  return all;
}
