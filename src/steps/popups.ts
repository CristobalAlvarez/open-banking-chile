import type { Page } from "puppeteer-core";
import { delay } from "../core/delay.js";

/** Cierra popups y modales genéricos */
export async function closePopups(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Escape");
    await delay(300);
  }
  await page.evaluate(() => {
    const closeButtons = Array.from(
      document.querySelectorAll(
        '[class*="close"], [aria-label*="close"], [aria-label*="cerrar"], button'
      )
    );
    for (const btn of closeButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text === "X" || text === "×" || text === "✕" || text === "Cerrar") {
        (btn as HTMLElement).click();
      }
    }
  });
  await delay(1000);
}
