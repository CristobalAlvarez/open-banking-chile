import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { formatRut } from "../../core/parsing.js";
import { detect2FA, waitFor2FA } from "../../steps/two-factor.js";

const LOGIN_URL = "https://banco.itau.cl/wps/portal/newolb/web/login";

const TWO_FACTOR_CONFIG = {
  keywords: ["itaú key", "aprueba", "segundo factor", "autoriza"],
};

const LOGIN_FORM_TIMEOUT_MS = 25000;

const SESSION_CONFIRM_TIMEOUT_MS = 15000;

// Mensajes de credenciales rechazadas, en masculino/femenino y singular/plural
// ("Clave incorrecta", "Rut o clave incorrectos", "Cuenta bloqueada").
const LOGIN_ERROR_PATTERN = /incorrect[oa]s?|bloquead[oa]s?|suspendid[oa]s?|inv[aá]lid[oa]s?/i;

/**
 * Waits for the Itaú login form to be usable.
 *
 * The site sits behind Imperva, which serves either a JS challenge or a hard
 * "Access Denied" block page to automated sessions instead of the login form.
 * Detecting that state lets us report the real cause instead of a misleading
 * "missing RUT field".
 */
async function waitForLoginForm(page: Page): Promise<"ok" | "blocked" | "timeout"> {
  try {
    await page.waitForSelector("#loginNameID", { timeout: LOGIN_FORM_TIMEOUT_MS });
    return "ok";
  } catch {
    // waitForSelector tolerates the navigations the Imperva challenge performs.
    const blocked = await page
      .evaluate(() =>
        /Access Denied|Acceso restringido|Pardon Our Interruption|actividad inusual|No pudimos validar tu acceso/i.test(
          document.body?.innerText || ""
        )
      )
      .catch(() => false);
    return blocked ? "blocked" : "timeout";
  }
}

/** Primer mensaje que habla de credenciales rechazadas, o `undefined` si ninguno lo hace. */
export function findLoginError(messages: string[]): string | undefined {
  return messages.find((message) => LOGIN_ERROR_PATTERN.test(message));
}

/**
 * Corre en el navegador. El portal con sesión trae el enlace "Cerrar sesión" en todas sus
 * páginas; la página de login no lo trae.
 */
export function hasPortalShell(): boolean {
  return Array.from(document.querySelectorAll("a")).some((a) =>
    /cerrar sesi[oó]n/i.test(a.textContent ?? "")
  );
}

async function confirmSession(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(hasPortalShell, { timeout: SESSION_CONFIRM_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password, twoFactorTimeoutSec } = options;
  const { page, debugLog, screenshot: doSave, saveHtml: doSaveHtml, progress } = session;

  progress("Abriendo sitio del banco...");
  debugLog.step("Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {
    /* the Imperva challenge/interstitial may never reach networkidle2 */
  });
  await delay(2000);
  await doSave(page, "01-login");
  await doSaveHtml(page, "01-login");

  debugLog.step("Waiting for login form...");
  const formState = await waitForLoginForm(page);
  if (formState === "blocked") {
    return (
      "Itaú bloqueó la sesión (protección anti-bot Imperva): la página de login nunca cargó. " +
      "El scraper debe correr en modo headful (con display/Xvfb) y sin sobreescribir el User-Agent."
    );
  }
  const rutEl = formState === "ok" ? await page.$("#loginNameID") : null;
  if (!rutEl) return "No se encontró campo de RUT (#loginNameID)";
  await rutEl.click({ clickCount: 3 });
  await rutEl.type(formatRut(rut), { delay: 45 });

  debugLog.step("Filling password...");
  const passEl = await page.$("#pswdId");
  if (!passEl) return "No se encontró campo de clave (#pswdId)";
  await passEl.click();
  await passEl.type(password, { delay: 45 });

  debugLog.step("Submitting login...");
  await doSave(page, "02-pre-submit");
  await page.evaluate(() => {
    const btn = document.getElementById("btnLoginRecaptchaV3");
    if (btn) btn.click();
  });
  try {
    await page.waitForNavigation({ timeout: 20000 });
  } catch {
    /* SPA */
  }
  await delay(3000);
  await doSave(page, "03-after-submit");
  await doSaveHtml(page, "03-after-submit");

  // Login error check: textos visibles de los contenedores de error/alerta del portal.
  const messages = await page.evaluate(() => {
    const sels = ['[class*="error"]', '[class*="alert"]', '[role="alert"]', ".msg-error-input"];
    const found: string[] = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el as HTMLElement).innerText?.trim();
        if (t && t.length > 3 && t.length < 300 && (el as HTMLElement).offsetParent !== null) {
          found.push(t);
        }
      }
    }
    return found;
  });
  const errorText = findLoginError(messages);
  if (errorText) return `Error de login: ${errorText}`;

  // 2FA
  if (await detect2FA(page, TWO_FACTOR_CONFIG)) {
    debugLog.step("2FA detected...");
    await doSave(page, "04-2fa");
    const approved = await waitFor2FA(page, debugLog, {
      ...TWO_FACTOR_CONFIG,
      timeoutSec: twoFactorTimeoutSec,
    });
    if (!approved) return "2FA no fue aprobado a tiempo (Itaú Key)";
    await delay(3000);
  }

  // Sin sesión las tablas salen vacías y el resultado parecería un éxito: un login que falla por
  // una causa que no reconocemos (otro mensaje, un paso intermedio del banco) se informa aquí.
  // El error es lo que ve el usuario final; la página donde quedó va al debug log, sin query
  // (puede traer tokens).
  if (!(await confirmSession(page))) {
    debugLog.push(`  Sesión no confirmada; página actual: ${page.url().replace(/[?#].*$/, "")}`);
    return (
      "No se pudo confirmar el inicio de sesión en Itaú. Verifica tu RUT y clave, o si el banco " +
      "pide un paso adicional en su sitio (cambio de clave, actualización de datos)."
    );
  }

  debugLog.step("Login OK!");
  return undefined;
}
