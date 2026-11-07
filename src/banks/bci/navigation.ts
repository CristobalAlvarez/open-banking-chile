import type { Page, Frame } from "puppeteer-core";
import { delay } from "../../core/delay.js";

export async function clickByTitle(page: Page, title: string): Promise<boolean> {
  return page.evaluate((t: string) => {
    const link = document.querySelector(`a[title="${t}"]`) as HTMLElement | null;
    if (link) {
      link.click();
      return true;
    }
    return false;
  }, title);
}

export async function waitForFrame(
  page: Page,
  urlPattern: string,
  timeoutMs = 10000
): Promise<Frame | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = page.frames().find((f) => f.url().includes(urlPattern));
    if (frame) return frame;
    await delay(500);
  }
  return null;
}
