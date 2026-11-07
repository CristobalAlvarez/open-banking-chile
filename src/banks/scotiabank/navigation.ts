import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import { allDeepJs } from "./deep-dom.js";

async function waitForDashboardContent(page: Page): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const hasContent = await page.evaluate(
      new Function(`${allDeepJs()}
      return allDeep(document, "a, button, span").some(el => {
        const text = el.innerText?.trim().toLowerCase() || "";
        return text === "ver cartola" || text === "cuenta corriente";
      });`) as () => boolean
    );
    if (hasContent) break;
    await delay(1500);
  }
}

/** Cierra el tutorial de bienvenida de Scotiabank (botones continuar/terminar/cerrar/omitir). */
export async function dismissScotiaTutorial(page: Page, debugLog: DebugLog): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const dismissed = await page.evaluate(
      new Function(`${allDeepJs()}
      for (const el of allDeep(document, "button, a, span")) {
        const text = el.innerText?.trim().toLowerCase() || "";
        if (text === "continuar" || text === "terminar" || text === "cerrar" || text === "omitir" || text === "saltar") {
          el.click(); return text;
        }
      }
      return null;`) as () => string | null
    );
    if (!dismissed) break;
    debugLog.push(`  Tutorial dismissed: "${dismissed}"`);
    await delay(600);
  }
}

/** Llega a la cartola de movimientos: "Ver cartola", menú lateral o tabs de saldos. */
export async function navigateToMovements(page: Page, debugLog: DebugLog): Promise<void> {
  await waitForDashboardContent(page);

  // Try "Ver cartola" (pierce Shadow DOM)
  const clickedCartola = await page.evaluate(
    new Function(`${allDeepJs()}
    for (const el of allDeep(document, "a, button, span")) {
      const text = el.innerText?.trim().toLowerCase() || "";
      if (text === "ver cartola" || text === "ver saldo y movimientos") {
        el.click(); return true;
      }
    }
    return false;`) as () => boolean
  );
  if (clickedCartola) {
    debugLog.push("  Clicked: Ver cartola");
    await delay(5000);
    return;
  }

  // Sidebar fallback
  const clickedCuentas = await page.evaluate(
    new Function(`${allDeepJs()}
    for (const el of allDeep(document, "a, button, li, span")) {
      if (el.innerText?.trim().toLowerCase() === "cuentas") { el.click(); return true; }
    }
    return false;`) as () => boolean
  );
  if (clickedCuentas) {
    debugLog.push("  Sidebar: Cuentas");
    await delay(2500);
  }

  // Try clicking "Saldos y últimos movimientos" tab first (NOT "Cartolas" which shows PDFs)
  const clickedSaldos = await page.evaluate(
    new Function(`${allDeepJs()}
    for (const el of allDeep(document, "a, button, [role='tab'], li, span")) {
      const text = el.innerText?.trim().toLowerCase() || "";
      if (text.includes("saldos y") || text.includes("últimos movimientos") || text === "saldos") {
        el.click(); return true;
      }
    }
    return false;`) as () => boolean
  );
  if (clickedSaldos) {
    debugLog.push("  Clicked: Saldos y últimos movimientos tab");
    await delay(5000);
    return;
  }

  const subTargets = ["movimientos", "estado de cuenta", "ver movimientos"];
  for (const target of subTargets) {
    const clicked = await page.evaluate(
      new Function(`${allDeepJs()}
      var target = ${JSON.stringify(target)};
      for (const el of allDeep(document, "a, button, [role='menuitem'], li, span")) {
        const text = el.innerText?.trim().toLowerCase() || "";
        if (text.includes(target) && text.length < 60) { el.click(); return true; }
      }
      return false;`) as () => boolean
    );
    if (clicked) {
      debugLog.push(`  Clicked: ${target}`);
      await delay(5000);
      return;
    }
  }
}

/** Espera a que la tabla (o las tarjetas) de movimientos termine de cargar. */
export async function waitForMovementsContent(page: Page, debugLog: DebugLog): Promise<void> {
  const startWait = Date.now();
  while (Date.now() - startWait < 20000) {
    const hasTable = await page.evaluate(
      new Function(`${allDeepJs()}
      // Check if a table with rows OR movement cards exist
      const tables = allDeep(document, "table");
      for (const t of tables) { if (t.querySelectorAll("tr").length > 1) return "table"; }
      // Check for card-style movements
      const cards = allDeep(document, "[class*='mov'], [class*='tran'], [class*='transaction']");
      if (cards.length > 0) return "cards";
      // Check if spinner is gone and there's text with amounts
      const body = document.body?.innerText || "";
      if (/\\$\\s*[\\d.]+/.test(body) && body.length > 500) return "text";
      return null;`) as () => string | null
    );
    if (hasTable) {
      debugLog.push(`  Content loaded: ${hasTable}`);
      break;
    }
    await delay(2000);
  }
}

/** Amplía el rango de fechas de la cartola eligiendo la opción más amplia de cada selector. */
export async function expandDateRange(page: Page): Promise<void> {
  try {
    const selectInfo = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      return selects.map((sel, i) => ({
        index: i,
        name: sel.name || sel.id || `select-${i}`,
        options: Array.from(sel.querySelectorAll("option")).map((o) => ({
          text: o.text.trim(),
          value: o.value,
        })),
      }));
    });
    for (const sel of selectInfo) {
      for (const opt of sel.options) {
        const text = opt.text.toLowerCase();
        if (
          text.includes("todos") ||
          text.includes("último mes") ||
          text.includes("30 día") ||
          text.includes("mes anterior")
        ) {
          await page.evaluate(
            (selIdx: number, optValue: string) => {
              const selects = document.querySelectorAll("select");
              const select = selects[selIdx];
              if (select) {
                select.value = optValue;
                select.dispatchEvent(new Event("change", { bubbles: true }));
              }
            },
            sel.index,
            opt.value
          );
          await delay(3000);
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
}
