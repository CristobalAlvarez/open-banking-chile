import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import { closePopups } from "../../steps/popups.js";
import { clickByText } from "../../steps/navigation.js";

/** Llega a la cartola de CuentaRUT desde el dashboard (link directo o menú lateral). */
export async function openMovements(page: Page, debugLog: DebugLog): Promise<void> {
  let navigated = await page.evaluate(() => {
    const links = document.querySelectorAll("a, button");
    for (const el of links) {
      const text = (el as HTMLElement).innerText?.trim().toLowerCase();
      if (
        text === "ir a movimientos" ||
        text === "ver movimientos" ||
        text === "ver más movimientos"
      ) {
        (el as HTMLElement).click();
        return text;
      }
    }
    return null;
  });

  if (navigated) {
    debugLog.push(`  Clicked: "${navigated}"`);
    await delay(5000);
    await closePopups(page);
  } else {
    // Sidebar fallback
    const sidebarClicked = await clickByText(page, ["cuentas"]);
    if (sidebarClicked) {
      await delay(2000);
      await clickByText(page, ["cuentarut", "cuenta rut", "movimientos", "cartola"]);
      await delay(5000);
      await closePopups(page);
    }
  }
}

/** Pulsa el paginador de movimientos. `true` si encontró y pulsó "siguiente". */
export async function clickNextPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const btns = document.querySelectorAll("button, a");
    for (const btn of btns) {
      const text = (btn as HTMLElement).innerText?.trim().toLowerCase();
      const el = btn as HTMLButtonElement;
      if (
        (text === "siguiente" ||
          text === "ver más" ||
          text === "cargar más" ||
          text.includes("›")) &&
        !el.disabled
      ) {
        el.click();
        return true;
      }
    }
    return false;
  });
}
