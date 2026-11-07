import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import type { BankMovement } from "../../core/types.js";

/** Recorre el paginador de Edwards (Angular Material / bch-paginator) acumulando movimientos. */
export async function paginate(
  page: Page,
  extractFn: (page: Page) => Promise<BankMovement[]>
): Promise<BankMovement[]> {
  const all: BankMovement[] = [];
  for (let i = 0; i < 50; i++) {
    all.push(...(await extractFn(page)));
    const clicked = await page.evaluate(() => {
      const matNext = document.querySelector(".mat-paginator-navigation-next:not([disabled])");
      if (matNext) {
        (matNext as HTMLElement).click();
        return true;
      }
      const bchNext = document.querySelector(
        "bch-paginator button[aria-label*='siguiente'], bch-paginator button[aria-label*='next']"
      );
      if (bchNext && !(bchNext as HTMLButtonElement).disabled) {
        (bchNext as HTMLElement).click();
        return true;
      }
      const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
      for (const btn of candidates) {
        const text = (btn as HTMLElement).innerText?.trim().toLowerCase();
        if (text === "siguiente" || text === "›" || text === ">" || text?.includes("ver más")) {
          if (
            (btn as HTMLButtonElement).disabled ||
            (btn as HTMLElement).classList.contains("disabled")
          )
            return false;
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) break;
    await delay(3000);
  }
  return deduplicateMovements(all);
}
