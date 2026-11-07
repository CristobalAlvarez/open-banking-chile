import type { Frame, Page } from "puppeteer-core";
import { delay } from "../core/delay.js";

export interface TwoFactorConfig {
  /** Keywords indicating 2FA is active */
  keywords?: string[];
  /** Timeout en segundos para la aprobación manual (mín. 30, máx. 600). Default: 180 */
  timeoutSec?: number;
  /** Also check iframes for 2FA text */
  frameFn?: (page: Page) => Promise<Frame | null>;
}

const DEFAULT_2FA_KEYWORDS = [
  "clave dinámica",
  "clave dinamica",
  "superclave",
  "segundo factor",
  "código de verificación",
  "codigo de verificacion",
  "ingresa tu token",
];

const REJECTION_KEYWORDS = ["rechazad", "denegad", "cancelad"];

const DEFAULT_2FA_TIMEOUT_SEC = 180;

async function readText(ctx: Page | Frame): Promise<string> {
  return await ctx.evaluate(() => (document.body?.innerText || "").toLowerCase());
}

async function getCombinedText(
  page: Page,
  frameFn?: (page: Page) => Promise<Frame | null>
): Promise<string> {
  let text = await readText(page);
  if (frameFn) {
    const frame = await frameFn(page);
    if (frame) {
      try {
        text += "\n" + (await readText(frame));
      } catch {
        // frame may have detached
      }
    }
  }
  return text;
}

function textHas2FA(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Detect if a 2FA challenge is currently shown */
export async function detect2FA(page: Page, config?: TwoFactorConfig): Promise<boolean> {
  const keywords = config?.keywords || DEFAULT_2FA_KEYWORDS;
  const text = await getCombinedText(page, config?.frameFn);
  return textHas2FA(text, keywords);
}

/**
 * Wait for the user to approve 2FA.
 * Returns true if approved, false if rejected or timed out.
 */
export async function waitFor2FA(
  page: Page,
  debugLog: string[],
  config?: TwoFactorConfig
): Promise<boolean> {
  const keywords = config?.keywords || DEFAULT_2FA_KEYWORDS;
  const requested = config?.timeoutSec ?? DEFAULT_2FA_TIMEOUT_SEC;
  const timeoutSec = Math.min(
    600,
    Math.max(30, Number.isFinite(requested) ? requested : DEFAULT_2FA_TIMEOUT_SEC)
  );

  debugLog.push(`  2FA detectado. Esperando aprobación manual (${timeoutSec}s máx)...`);
  const start = Date.now();

  while ((Date.now() - start) / 1000 < timeoutSec) {
    const text = await getCombinedText(page, config?.frameFn);

    if (!textHas2FA(text, keywords)) {
      if (REJECTION_KEYWORDS.some((kw) => text.includes(kw))) {
        debugLog.push("  2FA rechazado por el usuario.");
        return false;
      }
      debugLog.push("  2FA completado, continuando flujo.");
      return true;
    }

    await delay(1500);
  }

  debugLog.push(`  Timeout esperando aprobación 2FA (${timeoutSec}s).`);
  return false;
}
