import type { Page } from "puppeteer-core";
import { delay, deduplicateMovements } from "../utils.js";
import type { BankMovement } from "../types.js";

export interface PaginationConfig {
  /** Max pages to iterate (default 25) */
  maxPages?: number;
  /** Delay after clicking next (default 2500ms) */
  delayMs?: number;
  /** Custom next-button text patterns */
  nextTexts?: string[];
  /**
   * CSS selector del botón "siguiente" para paginadores sin texto
   * (ej. iconos: `'a[name="nextbtn"]'`). Tiene prioridad sobre nextTexts.
   */
  nextSelector?: string;
  /**
   * Selector cuyo texto debe cambiar para considerar la página cargada.
   * Para paginadores AJAX que re-renderizan sólo una región; si no cambia
   * dentro del timeout se asume que era la última página y se detiene.
   */
  waitForRefreshSelector?: string;
  /**
   * Hook tras extraer cada página (ej. guardar HTML de debug). Recibe el
   * número de página 1-based.
   */
  onPage?: (page: Page, pageNumber: number) => Promise<void>;
}

const DEFAULT_NEXT_TEXTS = ["siguiente", "ver más", "mostrar más"];
const REFRESH_TIMEOUT_MS = 10000;

async function clickNext(page: Page, texts: string[]): Promise<boolean> {
  return await page.evaluate((txts: string[]) => {
    const candidates = Array.from(document.querySelectorAll("button, a"));
    for (const candidate of candidates) {
      const text = (candidate as HTMLElement).innerText?.trim().toLowerCase() || "";
      if (!text) continue;
      if (!txts.some((t) => text.includes(t))) continue;

      const disabled =
        (candidate as HTMLButtonElement).disabled ||
        candidate.getAttribute("aria-disabled") === "true" ||
        candidate.classList.contains("disabled");
      if (disabled) return false;

      (candidate as HTMLElement).click();
      return true;
    }
    return false;
  }, texts);
}

async function clickNextBySelector(page: Page, selector: string): Promise<boolean> {
  return await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return false;
    if (
      (el as HTMLButtonElement).disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      el.classList.contains("disabled")
    ) {
      return false;
    }
    el.click();
    return true;
  }, selector);
}

/**
 * Paginate through movement pages, extracting data from each.
 * Calls extractFn on each page and accumulates results.
 */
export async function paginateAndExtract(
  page: Page,
  extractFn: (page: Page) => Promise<BankMovement[]>,
  debugLog: string[],
  config?: PaginationConfig,
): Promise<BankMovement[]> {
  const maxPages = config?.maxPages ?? 25;
  const delayMs = config?.delayMs ?? 2500;
  const texts = config?.nextTexts ?? DEFAULT_NEXT_TEXTS;
  const refreshSelector = config?.waitForRefreshSelector;
  const allMovements: BankMovement[] = [];

  for (let i = 0; i < maxPages; i++) {
    const movements = await extractFn(page);
    allMovements.push(...movements);
    await config?.onPage?.(page, i + 1);

    const snapshot = refreshSelector
      ? await page.evaluate((sel: string) => document.querySelector(sel)?.textContent?.trim() ?? "", refreshSelector)
      : "";

    const nextClicked = config?.nextSelector
      ? await clickNextBySelector(page, config.nextSelector)
      : await clickNext(page, texts);
    if (!nextClicked) break;

    debugLog.push(`  Pagination: loaded page ${i + 2}`);

    if (refreshSelector) {
      const changed = await page
        .waitForFunction(
          (prev: string, sel: string) => (document.querySelector(sel)?.textContent?.trim() ?? "") !== prev,
          { timeout: REFRESH_TIMEOUT_MS },
          snapshot,
          refreshSelector,
        )
        .then(() => true)
        .catch(() => false);
      if (!changed) break;
    } else {
      await delay(delayMs);
    }
  }

  return deduplicateMovements(allMovements);
}
