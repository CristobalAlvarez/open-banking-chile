/**
 * Segundo driver del proyecto: Playwright. Solo lo usa `banks/falabella`, cuyo scraper se escribió
 * sobre la API de locators de Playwright y NO pasa por `runScraper`/`BrowserSession` (Puppeteer).
 * Mantenerlo aquí deja el import del driver dentro de `browser/`, como exige dependency-cruiser.
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type Browser, type Page } from "playwright-core";
import { DebugLog } from "../core/debug-log.js";
import { findChrome } from "./chrome.js";
import type { ScraperOptions } from "../core/types.js";

export async function launchPlaywright(
  options: ScraperOptions
): Promise<{ browser: Browser; page: Page; debugLog: DebugLog }> {
  const { chromePath, headful, onDebug, proxyUrl } = options;
  const debugLog = new DebugLog(onDebug);

  const execPath = findChrome(chromePath);
  if (!execPath) {
    throw new Error(
      "No se encontró Chrome/Chromium. Instala Google Chrome o pasa chromePath.\n" +
        "  Ubuntu/Debian: sudo apt install google-chrome-stable\n" +
        "  macOS: brew install --cask google-chrome"
    );
  }

  const browser = await chromium.launch({
    executablePath: execPath,
    headless: !headful,
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-notifications",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  // Hide automation signals
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();
  return { browser, page, debugLog };
}

export async function screenshotIfEnabled(
  page: Page,
  name: string,
  enabled: boolean,
  debugLog: string[]
): Promise<string | undefined> {
  if (!enabled) return undefined;
  const safeName = name.replace(/[/\\:*?"<>|]/g, "_");
  const dir = path.resolve("screenshots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${safeName}.png`), fullPage: true });
  debugLog.push(`  Screenshot: ${safeName}.png`);
  return undefined;
}
