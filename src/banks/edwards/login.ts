import type { Frame, Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { fillRut, fillPassword, clickSubmit, detectLoginError } from "../../steps/login.js";
import { dismissBanners } from "../../steps/navigation.js";
import { closePopups } from "../../steps/popups.js";

export const BANK_URL = "https://portalpersonas.bancochile.cl/persona/";

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  debugLog.step("Navigating to Banco Edwards...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "load", timeout: 30000 });
  await delay(5000);
  await dismissBanners(page);
  await doSave(page, "01-loaded");

  // El formulario puede venir en un iframe
  const frames = page.frames();
  const bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0);
  let loginCtx: Page | Frame = page;
  if (bodyLen === 0 && frames.length > 1) {
    const f = frames.find(
      (fr) => fr !== page.mainFrame() && fr.url() && !fr.url().startsWith("about:")
    );
    if (f) {
      loginCtx = f;
      debugLog.push("  Formulario en iframe");
    }
  }

  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  if (!(await fillRut(loginCtx, rut))) return "No se encontró campo de RUT";
  await delay(1500);

  debugLog.step("Filling password...");
  let passOk = await fillPassword(page, password);
  if (!passOk) {
    // Flujo en dos pasos: el RUT se envía primero y la clave aparece después
    await page.keyboard.press("Enter");
    await delay(3000);
    passOk = await fillPassword(page, password);
  }
  if (!passOk) return "No se encontró campo de clave";
  await delay(1000);

  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  await clickSubmit(page, page);
  await delay(8000);
  await doSave(page, "02-after-login");

  const loginError = await detectLoginError(page);
  if (loginError) return `Error del banco: ${loginError}`;

  debugLog.step("Login OK!");
  progress("Sesión iniciada correctamente");
  await closePopups(page);
  return undefined;
}
