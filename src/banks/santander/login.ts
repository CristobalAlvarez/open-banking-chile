import type { Frame, Page } from "puppeteer-core";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { delay } from "../../core/delay.js";
import { fillRut, fillPassword, clickSubmit, detectLoginError } from "../../steps/login.js";
import { detect2FA, waitFor2FA } from "../../steps/two-factor.js";
import { clickByText, dismissBanners } from "../../steps/navigation.js";
import { closePopups } from "../../steps/popups.js";
import { BANK_URL } from "./constants.js";

const LOGIN_SELECTORS = {
  rutSelectors: ["#rut"],
  passwordSelectors: ["#pass"],
  rutFormat: "clean" as const,
};

const TWO_FACTOR_CONFIG = {
  frameFn: async (page: Page) => {
    const handle = await page.$("iframe#login-frame");
    return handle ? await handle.contentFrame() : null;
  },
};

async function getLoginFrame(page: Page): Promise<Frame | null> {
  const handle = await page.$("iframe#login-frame");
  return handle ? await handle.contentFrame() : null;
}

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1. Navigate
  debugLog.step("Navigating to Santander...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  await dismissBanners(page);
  await doSave(page, "01-homepage");

  // 2. Open login
  debugLog.step("Opening login form...");
  const loginOpened =
    (await page
      .$eval("#btnIngresar", (el) => {
        (el as HTMLElement).click();
        return true;
      })
      .catch(() => false)) ||
    (await clickByText(page, [
      "ingresar",
      "acceso clientes",
      "banco en linea",
      "iniciar sesión",
      "iniciar sesion",
    ]));

  if (!loginOpened) return "No se encontró el botón de ingreso.";

  await delay(3500);
  await doSave(page, "02-login");

  // Detect login iframe
  const loginFrame = await getLoginFrame(page);
  const ctx = loginFrame || page;
  if (loginFrame) {
    debugLog.push("  Login iframe detectado.");
  }

  // Wait for login inputs
  try {
    await ctx.waitForSelector("#rut", { timeout: 15000 });
    await ctx.waitForSelector("#pass", { timeout: 15000 });
  } catch {
    return "No cargaron los campos de login (#rut/#pass).";
  }

  // 3-5. Login
  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  const rutOk = await fillRut(ctx, rut, LOGIN_SELECTORS);
  if (!rutOk) return "No se encontró campo de RUT.";
  await delay(3500);

  debugLog.step("Filling password...");
  const passOk = await fillPassword(ctx, password, LOGIN_SELECTORS);
  if (!passOk) return "No se encontró campo de clave.";
  await delay(700);

  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  await clickSubmit(ctx, page, LOGIN_SELECTORS);
  await delay(7000);
  await doSave(page, "03-post-login");

  // 2FA check
  if (await detect2FA(page, TWO_FACTOR_CONFIG)) {
    const approved = await waitFor2FA(page, debugLog, {
      ...TWO_FACTOR_CONFIG,
      timeoutSec: options.twoFactorTimeoutSec,
    });
    await doSave(page, "03b-after-2fa");
    if (!approved) return "Timeout esperando aprobación de 2FA.";
  }

  // Login error check
  const loginError = await detectLoginError(page, await getLoginFrame(page));
  if (loginError) return `Error del banco: ${loginError}`;

  debugLog.step("Login OK.");
  progress("Sesión iniciada correctamente");
  await closePopups(page);

  return undefined;
}
