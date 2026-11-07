import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import { deduplicateMovements } from "../../core/movements.js";
import type { BankMovement } from "../../core/types.js";
import type { DebugLog } from "../../core/debug-log.js";
import { allDeepJs } from "./deep-dom.js";
import { extractMovements } from "./extract.js";

export async function scotiaPaginate(page: Page, debugLog: DebugLog): Promise<BankMovement[]> {
  const all: BankMovement[] = [];
  for (let i = 0; i < 20; i++) {
    all.push(...(await extractMovements(page)));
    const urlBefore = page.url();
    const nextClicked = await page.evaluate(
      new Function(`${allDeepJs()}
      const candidates = allDeep(document, "button, a, [role='button']");
      for (const btn of candidates) {
        const text = btn.innerText?.trim().toLowerCase() || "";
        if (!text.includes("siguiente") && !text.includes("ver más") && !text.includes("mostrar más") && text !== "›" && text !== ">") continue;
        if (btn.disabled || btn.getAttribute("aria-disabled") === "true" || btn.classList.contains("disabled")) return false;
        btn.click(); return true;
      }
      return false;`) as () => boolean
    );
    if (!nextClicked) break;
    await delay(3000);
    const urlAfter = page.url();
    if (
      new URL(urlBefore).pathname.split("/").slice(0, 6).join("/") !==
      new URL(urlAfter).pathname.split("/").slice(0, 6).join("/")
    ) {
      debugLog.push("  Pagination stopped: URL changed");
      break;
    }
    debugLog.push(`  Pagination: page ${i + 2}`);
  }
  return deduplicateMovements(all);
}
