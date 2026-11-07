import { delay } from "../../core/delay.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { detect2FA, waitFor2FA } from "../../steps/two-factor.js";
import { detectLoginError } from "../../steps/login.js";
import { formatRut } from "../../core/parsing.js";
import { LOGIN_URL, TWO_FACTOR_CONFIG } from "./constants.js";

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { rut, password, twoFactorTimeoutSec } = options;
  const { page, debugLog, screenshot: doSave } = session;

  debugLog.step("Navigating to BCI login...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await delay(3000);
  await doSave(page, "01-login-form");

  debugLog.step("Filling RUT...");
  const cleanRut = rut.replace(/[.\-\s]/g, "");
  const rutBody = cleanRut.slice(0, -1);
  const rutDv = cleanRut.slice(-1);
  const filled = await page.evaluate(
    (formatted: string, body: string, dv: string) => {
      const rutAux = document.getElementById("rut_aux") as HTMLInputElement | null;
      const rutHidden = document.getElementById("rut") as HTMLInputElement | null;
      const digHidden = document.getElementById("dig") as HTMLInputElement | null;
      if (!rutAux) return false;
      rutAux.value = formatted;
      rutAux.dispatchEvent(new Event("input", { bubbles: true }));
      rutAux.dispatchEvent(new Event("change", { bubbles: true }));
      rutAux.dispatchEvent(new Event("blur", { bubbles: true }));
      if (rutHidden) rutHidden.value = body;
      if (digHidden) digHidden.value = dv;
      return true;
    },
    formatRut(rut),
    rutBody,
    rutDv
  );
  if (!filled) return "Campo de RUT no encontrado.";

  debugLog.push("  Filling password...");
  const passFilled = await page.evaluate((pass: string) => {
    const clave = document.getElementById("clave") as HTMLInputElement | null;
    if (!clave) return false;
    clave.value = pass;
    clave.dispatchEvent(new Event("input", { bubbles: true }));
    clave.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, password);
  if (!passFilled) return "Campo de clave no encontrado.";

  await delay(500);
  debugLog.step("Submitting login...");
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = false;
    const form = document.getElementById("frm") as HTMLFormElement | null;
    if (form) form.submit();
    else if (btn) btn.click();
  });
  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    /* SPA */
  }
  await delay(3000);
  await doSave(page, "03-post-login");

  // 2FA
  if (await detect2FA(page, TWO_FACTOR_CONFIG)) {
    await doSave(page, "03b-2fa-challenge");
    const approved = await waitFor2FA(page, debugLog, {
      ...TWO_FACTOR_CONFIG,
      timeoutSec: twoFactorTimeoutSec,
    });
    if (!approved) return "Timeout esperando BCI Pass.";
    await delay(3000);
  }

  const loginError = await detectLoginError(page);
  if (loginError) return `Error del banco: ${loginError}`;

  if (page.url().includes("banco-en-linea/personas")) return "Login no navegó fuera de la página.";

  debugLog.step("Login OK!");
  return undefined;
}
