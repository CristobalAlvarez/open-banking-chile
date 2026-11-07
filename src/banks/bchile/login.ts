import { delay } from "../../core/delay.js";
import { formatRut } from "../../core/parsing.js";
import type { ScraperOptions } from "../../core/types.js";
import type { BrowserSession } from "../../browser/browser.js";
import { detect2FA, waitFor2FA } from "../../steps/two-factor.js";

import { BANK_URL } from "./constants.js";

/** Inicia sesión. Devuelve el mensaje de error si falla, o `undefined` si entró. */
export async function login(
  session: BrowserSession,
  options: ScraperOptions
): Promise<string | undefined> {
  const { page, debugLog, screenshot: doSave } = session;
  const { rut, password, twoFactorTimeoutSec } = options;

  debugLog.step("Navigating to bank homepage...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await delay(3000);
  await doSave(page, "01-homepage");

  try {
    await page.waitForSelector(
      'input[name="userRut"], input[name="rut"], #rut, input[placeholder*="RUT"]',
      { timeout: 15000 }
    );
  } catch {
    /* continue */
  }
  await delay(1000);

  // Fill RUT
  debugLog.step("Filling RUT...");
  const formattedRut = formatRut(rut);
  const cleanRut = rut.replace(/[.-]/g, "");
  const selectors = [
    "#ppriv_per-login-click-input-rut",
    'input[name="userRut"]',
    "#rut",
    'input[name="rut"]',
    'input[placeholder*="RUT"]',
  ];
  let rutFilled = false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const maxLen = await page.evaluate(
          (s: string) => (document.querySelector(s) as HTMLInputElement | null)?.maxLength ?? -1,
          sel
        );
        await el.click({ clickCount: 3 });
        await el.type(maxLen > 0 && maxLen <= 10 ? cleanRut : formattedRut, { delay: 45 });
        rutFilled = true;
        break;
      }
    } catch {
      /* next */
    }
  }
  if (!rutFilled) {
    // Fallback
    rutFilled = await page.evaluate(
      (rf: string, rc: string) => {
        for (const input of Array.from(document.querySelectorAll("input"))) {
          const el = input;
          if (el.offsetParent === null || el.disabled || el.type === "password") continue;
          el.focus();
          el.value = el.maxLength > 0 && el.maxLength <= 10 ? rc : rf;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      },
      formattedRut,
      cleanRut
    );
  }
  if (!rutFilled) return "No se encontró el campo de RUT";
  await delay(500);

  // Fill password
  debugLog.step("Filling password...");
  const passSelectors = [
    "#ppriv_per-login-click-input-password",
    'input[name="userPassword"]',
    "#pass",
    "#password",
    'input[type="password"]',
  ];
  let passFilled = false;
  for (const sel of passSelectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const isReadonly = await page.evaluate((s: string) => {
        const i = document.querySelector(s) as HTMLInputElement | null;
        return i?.readOnly || i?.disabled || false;
      }, sel);
      if (!isReadonly) {
        await el.click();
        await el.type(password, { delay: 45 });
        passFilled = true;
        break;
      }
      // Virtual keyboard fallback
      for (const kbSel of ['[class*="keyboard"]', '[class*="teclado"]', '[class*="virtual"]']) {
        const kb = await page.$(kbSel);
        if (!kb) continue;
        let allClicked = true;
        for (const char of password) {
          const clicked = await page.evaluate(
            (ch: string, s: string) => {
              const kbEl = document.querySelector(s);
              if (!kbEl) return false;
              for (const btn of Array.from(kbEl.querySelectorAll("button, span, div, a"))) {
                if ((btn as HTMLElement).innerText?.trim() === ch) {
                  (btn as HTMLElement).click();
                  return true;
                }
              }
              return false;
            },
            char,
            kbSel
          );
          if (!clicked) {
            allClicked = false;
            break;
          }
        }
        if (allClicked) {
          passFilled = true;
          break;
        }
      }
      if (passFilled) break;
    } catch {
      /* next */
    }
  }
  if (!passFilled) {
    // Two-step: submit RUT first
    const submitSelectors = [
      "#ppriv_per-login-click-ingresar-login",
      'button[type="submit"]',
      "#btn-login",
    ];
    for (const sel of submitSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        break;
      }
    }
    await delay(3000);
    for (const sel of passSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          await el.type(password, { delay: 45 });
          passFilled = true;
          break;
        }
      } catch {
        /* next */
      }
    }
  }
  if (!passFilled) return "No se encontró el campo de clave";

  // Submit
  debugLog.step("Submitting login...");
  const submitSelectors = [
    "#ppriv_per-login-click-ingresar-login",
    'button[type="submit"]',
    "#btn-login",
    "#btn_login",
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      submitted = true;
      break;
    }
  }
  if (!submitted) {
    await page.evaluate(() => {
      for (const btn of Array.from(document.querySelectorAll("button, a, input[type='submit']"))) {
        const text = (btn as HTMLElement).innerText?.trim().toLowerCase() || "";
        if (text.includes("ingresar") || text.includes("continuar")) {
          (btn as HTMLElement).click();
          return;
        }
      }
    });
  }
  try {
    await page.waitForNavigation({ timeout: 25000 });
  } catch {
    /* SPA */
  }
  await delay(5000);
  await doSave(page, "03-after-login");

  // Login error
  const loginError = await page.evaluate(() => {
    const keywords = [
      "clave incorrecta",
      "rut inválido",
      "bloqueada",
      "bloqueado",
      "suspendida",
      "sesión activa",
    ];
    for (const sel of ['[class*="error"]', '[class*="alert"]', '[role="alert"]']) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el as HTMLElement).innerText?.trim();
        if (text && keywords.some((kw) => text.toLowerCase().includes(kw))) return text;
      }
    }
    return null;
  });
  if (loginError) return `Error de login: ${loginError}`;

  // 2FA
  if (await detect2FA(page)) {
    const approved = await waitFor2FA(page, debugLog, { timeoutSec: twoFactorTimeoutSec });
    if (!approved) return "Timeout esperando aprobación de 2FA";
  }

  if (page.url().includes("/login")) return "Login failed — aún en página de login";

  debugLog.step("Login OK!");
  return undefined;
}
