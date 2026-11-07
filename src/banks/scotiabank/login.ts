import type { ScraperOptions } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import type { BrowserSession } from "../../browser/browser.js";
import { closePopups } from "../../steps/popups.js";
import { fillRut, fillPassword, clickSubmit, detectLoginError } from "../../steps/login.js";
import { dismissBanners } from "../../steps/navigation.js";
import { BANK_URL, LOGIN_SELECTORS } from "./constants.js";
import { dismissScotiaTutorial } from "./navigation.js";

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1. Navigate
  debugLog.step("Navigating to Scotiabank...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  await dismissBanners(page);
  await doSave(page, "01-homepage");

  // 2. Login
  debugLog.step("Clicking login button...");
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("a, button"))) {
      const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
      const href = (el as HTMLAnchorElement).href || "";
      if (
        text === "ingresar" ||
        text === "acceso clientes" ||
        text.includes("iniciar sesión") ||
        href.includes("login") ||
        href.includes("auth")
      ) {
        (el as HTMLElement).click();
        return;
      }
    }
  });
  await delay(4000);
  await doSave(page, "02-login-form");

  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  if (!(await fillRut(page, rut, LOGIN_SELECTORS))) {
    return "No se encontró campo de RUT";
  }
  await delay(1000);

  debugLog.step("Filling password...");
  let passOk = await fillPassword(page, password, LOGIN_SELECTORS);
  if (!passOk) {
    await page.keyboard.press("Enter");
    await delay(3000);
    passOk = await fillPassword(page, password, LOGIN_SELECTORS);
  }
  if (!passOk) {
    return "No se encontró campo de clave";
  }
  await delay(800);

  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  await clickSubmit(page, page, LOGIN_SELECTORS);
  await delay(8000);
  await doSave(page, "03-after-login");

  // 2FA check
  const pageContent = (await page.content()).toLowerCase();
  if (
    pageContent.includes("clave dinámica") ||
    pageContent.includes("segundo factor") ||
    pageContent.includes("código de verificación") ||
    pageContent.includes("token")
  ) {
    return "El banco pide clave dinámica o 2FA.";
  }

  const loginError = await detectLoginError(page);
  if (loginError) {
    return `Error del banco: ${loginError}`;
  }

  debugLog.step("Login OK!");
  progress("Sesión iniciada correctamente");
  await closePopups(page);
  await dismissScotiaTutorial(page, debugLog);

  return undefined;
}
