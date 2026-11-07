import type { ScraperOptions } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import type { BrowserSession } from "../../browser/browser.js";
import { fillRut, fillPassword, detectLoginError } from "../../steps/login.js";
import { dismissBanners } from "../../steps/navigation.js";
import { closePopups } from "../../steps/popups.js";
import { waitForDashboard } from "./navigation.js";

export const BANK_URL = "https://www.bancosecurity.cl";
const LOGIN_URL = "https://www.bancosecurity.cl/widgets/wPersonasLogin/index.asp";

const LOGIN_SELECTORS = {
  rutSelectors: ["#frut", 'input[name="frut"]'],
  passwordSelectors: ["#clave", 'input[name="clave"]'],
  // Portal expects formatted RUT: "12.345.678-9"
  rutFormat: "formatted" as const,
};

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1. Navigate to login
  debugLog.step("Navigating to Banco Security login...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  await dismissBanners(page);
  await doSave(page, "01-homepage");

  // Click "Ingresar" to load the login widget
  debugLog.step("Clicking Ingresar...");
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll("a, button"))) {
      const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
      if (text === "ingresar") {
        (el as HTMLElement).click();
        return;
      }
    }
  });
  await delay(4000);
  await doSave(page, "02-login-form");

  // If click didn't navigate, go directly
  if (!page.url().includes("wPersonasLogin")) {
    debugLog.push("  Fallback: navigating directly to login URL");
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 20000 });
    await delay(2000);
  }

  // 3. Fill RUT
  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  if (!(await fillRut(page, rut, LOGIN_SELECTORS))) return "No se encontró campo de RUT";
  await delay(800);

  // 4. Fill password
  debugLog.step("Filling password...");
  if (!(await fillPassword(page, password, LOGIN_SELECTORS)))
    return "No se encontró campo de clave";
  await delay(800);

  // 5. Submit
  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  const submitted = await page.evaluate(() => {
    const btn = document.querySelector(
      'input[type="submit"], button[type="submit"]'
    ) as HTMLElement | null;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!submitted) await page.keyboard.press("Enter");
  await waitForDashboard(page);
  await doSave(page, "03-after-login");

  // 6. Validate login
  const loginError = await detectLoginError(page);
  if (loginError) return `Error del banco: ${loginError}`;

  // Check if we're still on the login page (login failed) vs on the dashboard (login OK)
  const currentUrl = page.url();
  const stillOnLogin = currentUrl.includes("wPersonasLogin") || currentUrl.includes("login");
  if (stillOnLogin) {
    // Only now check visible page text for 2FA prompts
    const visibleText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || "");
    const is2FA =
      visibleText.includes("ingresa tu código") ||
      visibleText.includes("ingrese su código") ||
      visibleText.includes("segundo factor") ||
      visibleText.includes("clave dinámica");
    if (is2FA) return "El banco pide 2FA. No automatizable.";
  }

  debugLog.step("Login OK!");
  progress("Sesión iniciada");
  await closePopups(page);
  return undefined;
}
