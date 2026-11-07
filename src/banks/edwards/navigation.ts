import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";

const NAV_TARGETS = [
  { text: "saldos y mov. cuentas", exact: false },
  { text: "saldos y mov. tarjetas", exact: false },
  { text: "cartola", exact: false },
  { text: "últimos movimientos", exact: false },
  { text: "movimientos", exact: true },
  { text: "estado de cuenta", exact: false },
  { text: "historial", exact: false },
];

const TC_TARGETS = ["saldos y mov. tarjetas", "tarjetas crédito"];

async function clickNavTarget(page: Page, debugLog: DebugLog): Promise<boolean> {
  for (const target of NAV_TARGETS) {
    const result = await page.evaluate((t: { text: string; exact: boolean }) => {
      const elements = Array.from(
        document.querySelectorAll("a, button, [role='tab'], [role='menuitem'], li, span")
      );
      for (const el of elements) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
        const match = t.exact ? text === t.text : text.includes(t.text);
        if (match && text.length < 50) {
          (el as HTMLElement).click();
          return `Clicked: "${text}"`;
        }
      }
      return null;
    }, target);
    if (result) {
      debugLog.push(`  ${result}`);
      await delay(4000);
      return true;
    }
  }
  return false;
}

/** Llega a la cartola de la cuenta: por el menú o, si no está, entrando primero a la cuenta. */
export async function openAccountMovements(page: Page, debugLog: DebugLog): Promise<void> {
  if (await clickNavTarget(page, debugLog)) return;

  const clickedAccount = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("a, div, button, tr, li"))) {
      const text = (el as HTMLElement).innerText?.trim() || "";
      if (
        (text.toLowerCase().includes("cuenta corriente") ||
          text.toLowerCase().includes("cuenta vista") ||
          text.toLowerCase().includes("cuenta")) &&
        text.length < 100
      ) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (clickedAccount) {
    await delay(4000);
    await clickNavTarget(page, debugLog);
  }
}

/** Amplía el rango de fechas de la cartola eligiendo la opción más amplia de cada selector. */
export async function tryExpandDateRange(page: Page, debugLog: DebugLog): Promise<void> {
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
          text.includes("60 día") ||
          text.includes("90 día") ||
          text.includes("6 mes") ||
          text.includes("3 mes") ||
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
          debugLog.push(`  Changed [${sel.name}] to "${opt.text}"`);
          await delay(3000);
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
}

/** Vuelve al inicio y entra a la sección de tarjetas. `false` si no encuentra el acceso. */
export async function openCreditCards(page: Page): Promise<boolean> {
  const baseUrl = page.url().split("#")[0];
  await page.goto(`${baseUrl}#/home`, { waitUntil: "load", timeout: 15000 });
  await delay(3000);

  for (const t of TC_TARGETS) {
    const result = await page.evaluate((text: string) => {
      for (const el of Array.from(
        document.querySelectorAll("a, button, [role='tab'], [role='menuitem'], li, span")
      )) {
        const label = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
        if (label.includes(text) && label.length < 50) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, t);
    if (result) {
      await delay(4000);
      return true;
    }
  }
  return false;
}
