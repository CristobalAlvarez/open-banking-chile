import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { closePopups } from "../../steps/popups.js";
import { clickByText } from "../../steps/navigation.js";
import { LOGIN_URL } from "./constants.js";

async function fillRut(page: Page, rut: string): Promise<boolean> {
  const rutInput = await page.$("#rut");
  if (!rutInput) return false;

  await rutInput.click();
  await delay(500);

  // Angular removes readonly on focus — force-remove if still present
  const isReadonly = await page.evaluate(() => {
    const input = document.querySelector("#rut") as HTMLInputElement;
    if (input?.hasAttribute("readonly")) {
      input.removeAttribute("readonly");
      input.focus();
      return true;
    }
    return false;
  });
  if (isReadonly) await delay(300);

  await rutInput.click({ clickCount: 3 });
  const cleanRut = rut.replace(/[.-]/g, "");
  await rutInput.type(cleanRut, { delay: 80 });

  // Trigger Angular change detection
  await page.evaluate(() => {
    const input = document.querySelector("#rut") as HTMLInputElement;
    if (input) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  return true;
}

async function fillPassword(page: Page, password: string): Promise<boolean> {
  const passInput = await page.$("#pass");
  if (!passInput) return false;

  await passInput.click({ clickCount: 3 });
  await passInput.type(password, { delay: 80 });

  await page.evaluate(() => {
    const input = document.querySelector("#pass") as HTMLInputElement;
    if (input) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  return true;
}

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  // 1. Navigate
  debugLog.step("Navigating to BancoEstado login...");
  progress("Abriendo sitio del banco...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(3000);
  await closePopups(page);
  await doSave(page, "01-homepage");

  // 2. Wait for login form
  debugLog.step("Waiting for login offcanvas...");
  try {
    await page.waitForSelector(".msd-custom-sidenav__container #rut", {
      visible: true,
      timeout: 15000,
    });
  } catch {
    await clickByText(page, ["ingresar", "banca en línea", "login"]);
    await delay(3000);
    await page.waitForSelector("#rut", { visible: true, timeout: 10000 });
  }
  await doSave(page, "02-login-form");

  // 3-4. Fill credentials
  debugLog.step("Filling RUT...");
  progress("Ingresando RUT...");
  if (!(await fillRut(page, rut))) return "No se pudo llenar el RUT";

  debugLog.step("Filling password...");
  progress("Ingresando clave...");
  if (!(await fillPassword(page, password))) return "No se pudo llenar la clave";
  await doSave(page, "03-credentials");

  // 5. Submit
  debugLog.step("Submitting login...");
  progress("Iniciando sesión...");
  const submitBtn = await page.$("#btnLogin");
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.evaluate(() => {
      const form = document.querySelector("form");
      if (form) form.dispatchEvent(new Event("submit", { bubbles: true }));
    });
  }

  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    await delay(5000);
  }
  await delay(3000);
  await closePopups(page);
  await doSave(page, "04-post-login");

  // Check login errors
  const loginError = await page.evaluate(() => {
    const errorKeywords = [
      "contraseña",
      "clave incorrecta",
      "rut inválido",
      "credenciales",
      "bloqueado",
      "intente nuevamente",
      "reintente",
    ];
    const errorEls = document.querySelectorAll(
      '[class*="error"], [class*="alert"], .input-messages'
    );
    for (const el of errorEls) {
      const text = (el as HTMLElement).innerText?.trim().toLowerCase();
      if (text && errorKeywords.some((kw) => text.includes(kw)))
        return (el as HTMLElement).innerText?.trim();
    }
    return null;
  });
  if (loginError) return `Login fallido: ${loginError}`;

  // Dismiss promo modals
  await page.evaluate(() => {
    const btns = document.querySelectorAll("button, a");
    for (const btn of btns) {
      const text = (btn as HTMLElement).innerText?.trim().toLowerCase();
      if (text === "no por ahora" || text === "cerrar" || text === "×") {
        (btn as HTMLElement).click();
        break;
      }
    }
  });
  await delay(1000);

  const postLoginUrl = new URL(page.url());
  debugLog.push(`  Login OK! URL: ${postLoginUrl.origin}${postLoginUrl.pathname}`);
  progress("Sesión iniciada correctamente");

  return undefined;
}
