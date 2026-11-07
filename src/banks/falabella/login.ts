import type { Page } from "playwright-core";
import type { DebugLog } from "../../core/debug-log.js";
import { delay } from "../../core/delay.js";
import { screenshotIfEnabled } from "../../browser/playwright.js";

export const BANK_URL = "https://www.bancofalabella.cl";

export async function login(
  page: Page,
  rut: string,
  password: string,
  debugLog: DebugLog,
  doScreenshots: boolean,
  progress: (s: string) => void
): Promise<{ success: true } | { success: false; error: string; screenshot?: string }> {
  debugLog.step("Navigating to bank homepage...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "networkidle" });
  await delay(2000);

  // Dismiss banners/popups
  try {
    const acceptBtn = page
      .locator("button, a")
      .filter({ hasText: /^(Aceptar|Entendido|Continuar)$/i })
      .first();
    if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) await acceptBtn.click();
  } catch {
    /* no banner */
  }
  await screenshotIfEnabled(page, "01-homepage", doScreenshots, debugLog);

  // Click "Mi cuenta" (triggers navigation)
  debugLog.step("Clicking 'Mi cuenta'...");
  progress("Ingresando a Mi cuenta...");
  try {
    await page
      .locator("a, button")
      .filter({ hasText: "Mi cuenta" })
      .first()
      .click({ timeout: 5000 });
  } catch {
    /* may cause navigation context change */
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await delay(3000);
  await screenshotIfEnabled(page, "02-login-form", doScreenshots, debugLog);

  // Fill RUT
  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  const rutInput = page
    .getByRole("textbox", { name: "RUT", exact: true })
    .or(page.locator('input[name*="rut"], input[id*="rut"], input[placeholder*="RUT"]').first());
  try {
    await rutInput.fill(rut, { timeout: 10000 });
  } catch {
    const ss = (await page.screenshot()).toString("base64");
    return { success: false, error: "No se encontró campo de RUT", screenshot: ss };
  }
  await delay(1000);

  // Advance to password step (Falabella uses two-step modal)
  await page.keyboard.press("Enter");
  debugLog.push("  Pressed Enter to advance to password step");
  await delay(2000);

  // Fill password
  debugLog.step("Filling password...");
  progress("Ingresando clave...");
  const pwdInput = page
    .locator('input[type="password"]')
    .first()
    .or(page.getByRole("textbox", { name: /[Cc]lave/ }).first());
  try {
    await pwdInput.fill(password, { timeout: 10000 });
  } catch {
    const ss = (await page.screenshot()).toString("base64");
    return { success: false, error: "No se encontró campo de clave", screenshot: ss };
  }
  await delay(500);

  // Submit login
  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  // Try clicking submit button, fallback to Enter
  const submitBtn = page
    .locator('button[type="submit"], input[type="submit"]')
    .first()
    .or(page.getByRole("button", { name: /ingresar|entrar|btn-md/i }).first());
  try {
    await submitBtn.click({ timeout: 3000 });
  } catch {
    await page.keyboard.press("Enter");
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  await delay(8000);
  await screenshotIfEnabled(page, "03-after-login", doScreenshots, debugLog);

  // Close post-login popups
  try {
    const closeBtn = page.getByRole("button", { name: "cerrar", exact: true });
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) await closeBtn.click();
  } catch {
    /* no popup */
  }

  // Retry if products failed to load
  try {
    const retryBtn = page.getByText("Reintentar");
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await retryBtn.click();
      await delay(5000);
    }
  } catch {
    /* products loaded fine */
  }

  // 2FA check
  const content = await page.content();
  if (
    content.toLowerCase().includes("clave dinámica") ||
    content.toLowerCase().includes("segundo factor")
  ) {
    const ss = (await page.screenshot()).toString("base64");
    return { success: false, error: "El banco pide clave dinámica (2FA).", screenshot: ss };
  }

  // Error check
  const errorText = await page
    .locator('[class*="error"], [class*="alert"], [role="alert"]')
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  if (errorText && errorText.trim().length > 5 && errorText.trim().length < 200) {
    const ss = (await page.screenshot()).toString("base64");
    return { success: false, error: `Error del banco: ${errorText.trim()}`, screenshot: ss };
  }

  debugLog.step("Login OK!");
  progress("Sesión iniciada correctamente");
  return { success: true };
}
