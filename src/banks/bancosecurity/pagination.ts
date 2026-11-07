import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import { deduplicateMovements } from "../../core/movements.js";
import type { BankMovement } from "../../core/types.js";
import { extractMovements } from "./extract.js";

export async function paginate(page: Page, debugLog: DebugLog): Promise<BankMovement[]> {
  const all: BankMovement[] = [];
  for (let i = 0; i < 20; i++) {
    all.push(...(await extractMovements(page)));
    const urlBefore = page.url();
    const nextClicked = await page.evaluate(() => {
      for (const btn of Array.from(document.querySelectorAll("button, a, [role='button']"))) {
        const text = (btn as HTMLElement).innerText?.trim().toLowerCase() || "";
        if (
          !text.includes("siguiente") &&
          !text.includes("ver más") &&
          !text.includes("mostrar más") &&
          text !== "›" &&
          text !== ">"
        )
          continue;
        if (
          (btn as HTMLButtonElement).disabled ||
          btn.getAttribute("aria-disabled") === "true" ||
          btn.classList.contains("disabled")
        )
          return false;
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });
    if (!nextClicked) break;
    await delay(3000);
    const urlAfter = page.url();
    if (urlBefore !== urlAfter) {
      debugLog.push("  Pagination stopped: URL changed");
      break;
    }
    debugLog.push(`  Pagination: page ${i + 2}`);
  }
  return deduplicateMovements(all);
}
