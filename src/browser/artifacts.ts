import * as fs from "fs";
import * as path from "path";
import type { Page } from "puppeteer-core";

/** Guarda un screenshot si saveScreenshots está habilitado */
export async function saveScreenshot(
  page: Page,
  name: string,
  enabled: boolean,
  debugLog: string[]
): Promise<void> {
  if (!enabled) return;
  // Sanitize name to prevent path traversal
  const safeName = name.replace(/[/\\:*?"<>|]/g, "_");
  const dir = path.resolve("screenshots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${safeName}.png`),
    fullPage: true,
  });
  debugLog.push(`  Screenshot saved: screenshots/${safeName}.png`);
}

/**
 * Guarda el HTML de la página en debug/ si saveScreenshots está habilitado.
 * Útil para inspeccionar selectores/DOM de una página del banco (ver AGENTS.md).
 */
export async function saveHtml(
  page: Page,
  name: string,
  enabled: boolean,
  debugLog: string[]
): Promise<void> {
  if (!enabled) return;
  // Sanitize name to prevent path traversal
  const safeName = name.replace(/[/\\:*?"<>|]/g, "_");
  const dir = path.resolve("debug");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const html = await page.content();
  fs.writeFileSync(path.join(dir, `${safeName}.html`), html);
  debugLog.push(`  HTML saved: debug/${safeName}.html`);
}
