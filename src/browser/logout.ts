import type { Page } from "puppeteer-core";
import { delay } from "../core/delay.js";

/** Cierra sesión buscando botones de logout comunes */
export async function logout(page: Page, debugLog: string[]): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("a, button, span, div, li"));
      for (const el of elements) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase();
        if (
          text === "cerrar sesión" ||
          text === "cerrar sesion" ||
          text === "salir" ||
          text === "logout" ||
          text === "sign out"
        ) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (clicked) {
      debugLog.push("  Logged out successfully");
      await delay(2000);
    }
  } catch {
    // best effort — browser.close() ends the session anyway
  }
}
