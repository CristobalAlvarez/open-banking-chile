import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { BankMovement } from "../../core/types.js";

/** Recorre el paginador de BICE (botón "Siguiente") acumulando movimientos. */
export async function paginate(
  page: Page,
  extractFn: (page: Page) => Promise<BankMovement[]>
): Promise<BankMovement[]> {
  const all: BankMovement[] = [];
  for (let i = 0; i < 50; i++) {
    all.push(...(await extractFn(page)));
    const isDisabled = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const span = btn.querySelector("span");
        if (span?.textContent?.trim() === "Siguiente") return btn.classList.contains("is-disabled");
      }
      return true;
    });
    if (isDisabled) break;
    await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const span = btn.querySelector("span");
        if (span?.textContent?.trim() === "Siguiente") {
          btn.click();
          return;
        }
      }
    });
    await delay(3000);
  }
  return all;
}
