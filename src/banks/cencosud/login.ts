import type { Page } from "puppeteer-core";
import type { ScraperOptions } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import type { DebugLog } from "../../core/debug-log.js";
import type { BrowserSession } from "../../browser/browser.js";
import { closePopups } from "../../steps/popups.js";
import { fillRut, fillPassword, clickSubmit, detectLoginError } from "../../steps/login.js";

export const BANK_URL = "https://www.mitarjetacencosud.cl/login";

/**
 * Detect whether an hCaptcha/reCAPTCHA challenge is currently blocking the page.
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    if (document.querySelector('iframe[src*="hcaptcha"], iframe[src*="recaptcha"]')) return true;
    if (document.querySelector('.h-captcha, .g-recaptcha, [id*="hcaptcha"], [class*="hcaptcha"]'))
      return true;
    const text = (document.body?.innerText || "").toLowerCase();
    return text.includes("select all images") || text.includes("i am not a robot");
  });
}

/**
 * Wait up to `timeoutSec` seconds for the user to solve the CAPTCHA.
 * Returns true when the CAPTCHA disappears, false on timeout.
 */
async function waitForCaptcha(page: Page, debugLog: DebugLog, timeoutSec = 180): Promise<boolean> {
  debugLog.push(
    `  CAPTCHA detectado — resuelve manualmente en el navegador (${timeoutSec}s máx)...`
  );
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const still = await detectCaptcha(page);
    if (!still) {
      debugLog.push("  CAPTCHA resuelto, continuando...");
      return true;
    }
    await delay(2000);
  }
  debugLog.push(`  Timeout esperando CAPTCHA (${timeoutSec}s).`);
  return false;
}

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1. Navigate to login
  debugLog.step("Navigating to Tarjeta Cencosud...");
  progress("Abriendo sitio de Tarjeta Cencosud...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 40000 });
  await delay(2000);
  await closePopups(page);
  await doSave(page, "01-loaded");

  // 2. Fill RUT
  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");

  if (!(await fillRut(page, rut, { rutFormat: "clean" }))) {
    return "No se encontró campo de RUT";
  }
  await delay(800);
  await doSave(page, "02-rut-filled");

  // 3. Fill password
  debugLog.step("Filling password...");
  progress("Ingresando clave...");

  if (!(await fillPassword(page, password))) {
    return "No se encontró campo de clave";
  }
  await delay(600);

  // 4. Submit — wait for navigation triggered by login
  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");

  const loginNavPromise = page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
    .catch(() => {});
  await clickSubmit(page, page, { submitTexts: ["ingresar", "entrar"] });

  // Give the page a moment to either navigate or show a CAPTCHA
  await delay(2500);

  // 4b. Handle CAPTCHA if it appeared instead of a navigation
  if (await detectCaptcha(page)) {
    if (!options.headful) {
      // Can't solve an image CAPTCHA in headless mode — tell the user to rerun headful
      return "CAPTCHA detectado en modo headless. Ejecuta nuevamente con headful: true para resolverlo manualmente.";
    }
    progress("CAPTCHA detectado — resuélvelo en el navegador...");
    const captchaTimeoutSec = options.captchaTimeoutSec ?? 180;
    const solved = await waitForCaptcha(page, debugLog, captchaTimeoutSec);
    if (!solved) {
      return "Timeout esperando CAPTCHA — resuélvelo en el navegador y vuelve a intentarlo";
    }
    // After CAPTCHA is solved the form submits and the page navigates
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {});
    await delay(2000);
  } else {
    await loginNavPromise;
    await delay(2000);
  }

  await doSave(page, "03-after-login");

  // 5. Check for login error
  const loginError = await detectLoginError(page);
  if (loginError) return `Error del banco: ${loginError}`;

  debugLog.step("Login OK!");
  progress("Sesión iniciada");
  await closePopups(page);
  await delay(1000);
  return undefined;
}
