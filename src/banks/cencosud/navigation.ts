import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";

/**
 * Click a link/button by its exact text, then wait for the SPA to settle.
 * Sets up waitForNavigation BEFORE the click to correctly catch SPA navigations.
 */
async function clickAndWait(
  page: Page,
  texts: string[],
  debugLog: DebugLog,
  timeout = 15000
): Promise<boolean> {
  for (const txt of texts) {
    // Register navigation listener before click so it catches the event
    const navPromise = page
      .waitForNavigation({ waitUntil: "networkidle2", timeout })
      .catch(() => {});
    const clicked = await page.evaluate((t: string) => {
      const els = Array.from(document.querySelectorAll("a, button, span, div, li"));
      for (const el of els) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
        if (text === t && text.length < 60) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, txt.toLowerCase());

    if (clicked) {
      await navPromise;
      debugLog.push(`  Clicked: "${txt}"`);
      await delay(2000);
      return true;
    } else {
      // Cancel the pending navPromise by navigating nowhere (it will resolve via catch)
      navPromise.catch(() => {});
    }
  }
  return false;
}

/** Abre la página completa de movimientos ("Ver todos", con el menú lateral como respaldo). */
export async function openMovementsPage(page: Page, debugLog: DebugLog): Promise<void> {
  const navOk = await clickAndWait(
    page,
    ["Ver todos", "Ver todo", "Ver más movimientos"],
    debugLog,
    20000
  );
  if (!navOk) {
    // Fallback: sidebar "Movimientos" link
    await clickAndWait(page, ["Movimientos", "Mis movimientos"], debugLog, 15000);
  }
}

/** Abre la sección de movimientos facturados. `false` si no encuentra el acceso. */
export async function openBilledMovements(page: Page, debugLog: DebugLog): Promise<boolean> {
  return clickAndWait(
    page,
    ["Ir a Movimientos Facturados", "Movimientos Facturados", "Facturados", "Estado de cuenta"],
    debugLog,
    20000
  );
}

/**
 * Selecciona una pestaña de la tabla de movimientos (Nacionales / Internacionales).
 * Exact-match required: "nacionales" must not accidentally click a container
 * whose innerText *contains* "internacionales" (which includes "nacionales").
 */
export async function selectTab(page: Page, tabText: string, debugLog: DebugLog): Promise<boolean> {
  const clicked = await page.evaluate((txt: string) => {
    for (const el of Array.from(document.querySelectorAll("[role='tab'], button, li, span, div"))) {
      if ((el as HTMLElement).innerText?.trim().toLowerCase() === txt) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, tabText.toLowerCase());

  if (clicked) {
    debugLog.push(`  Tab "${tabText}" selected`);
    await delay(2000);
  }
  return clicked;
}
