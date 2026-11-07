import { delay } from "../../core/delay.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";

export const BANK_URL = "https://banco.bice.cl/personas";

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password } = options;
  const { page, debugLog, screenshot: doSave } = session;

  debugLog.step("Navigating to bank homepage...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  await doSave(page, "01-homepage");

  debugLog.step("Opening login dropdown...");
  const loginDropdown = await page.$("#login-dropdown");
  if (!loginDropdown) {
    return "No se encontró el botón de login (#login-dropdown)";
  }
  await loginDropdown.click();
  await delay(1500);

  try {
    await page.waitForSelector(".dropdown-menu.show", { timeout: 5000 });
  } catch {
    await loginDropdown.click();
    await delay(2000);
  }

  debugLog.step("Clicking 'Personas'...");
  const personasLink = await page.$('a[data-click="Personas"]');
  if (!personasLink) {
    return "No se encontró el link 'Personas'";
  }
  await personasLink.click();

  // Multi-redirect: banco.bice.cl → portalpersonas → auth.bice.cl
  debugLog.step("Waiting for login form...");
  const browser = page.browser();
  let loginPage = page;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 25000);
      const interval = setInterval(async () => {
        const allPages = await browser.pages();
        for (const p of allPages) {
          if (p.url().includes("auth.bice.cl")) {
            loginPage = p;
            session.page = loginPage;
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
            return;
          }
        }
      }, 1000);
    });
    await loginPage.waitForSelector("#username", { timeout: 15000 });
  } catch {
    return "No se cargó la página de login (timeout)";
  }
  await doSave(loginPage, "02-login-form");

  debugLog.step("Filling RUT...");
  const rutField = await loginPage.$("#username");
  if (!rutField) {
    return "No se encontró campo de RUT (#username)";
  }
  await rutField.click();
  await rutField.type(rut.replace(/[.-]/g, ""), { delay: 50 });

  debugLog.step("Filling password...");
  const passField = await loginPage.$("#password");
  if (!passField) {
    return "No se encontró campo de clave (#password)";
  }
  await passField.click();
  await passField.type(password, { delay: 50 });
  await delay(500);

  debugLog.step("Submitting login...");
  await doSave(loginPage, "03-pre-submit");
  const submitBtn = await loginPage.$("#kc-login");
  if (submitBtn) await submitBtn.click();
  else await loginPage.keyboard.press("Enter");

  try {
    await loginPage.waitForNavigation({ timeout: 20000 });
  } catch {
    /* SPA */
  }
  await delay(3000);
  await doSave(loginPage, "04-after-login");

  if (loginPage.url().includes("auth.bice.cl")) {
    const errorText = await loginPage.evaluate(() => {
      const el = document.querySelector('[class*="error"], [class*="alert"], [role="alert"]');
      return el ? (el as HTMLElement).innerText?.trim() : null;
    });
    return `Error de login: ${errorText || "Credenciales inválidas"}`;
  }

  debugLog.step("Login OK!");
  return undefined;
}
