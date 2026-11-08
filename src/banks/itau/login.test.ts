import { describe, it, expect, vi } from "vitest";
import type { Page } from "puppeteer-core";
import type { BrowserSession } from "../../browser/browser.js";
import { DebugLog } from "../../core/debug-log.js";
import { domPage, pageFromHtml } from "../../testing/dom.js";
import { findLoginError, hasPortalShell, login } from "./login.js";

// `login` espera con `delay` (2–3 s) entre pasos; en el test no hay nada que esperar.
vi.mock("../../core/delay.js", () => ({ delay: () => Promise.resolve() }));

const LOGIN_FORM = `
  <form>
    <input id="loginNameID" />
    <input id="pswdId" type="password" />
    <button id="btnLoginRecaptchaV3" type="button">Ingresar</button>
  </form>`;

const PORTAL = `
  <nav><a href="/inicio">Inicio</a><a href="/salir">Cerrar sesión</a></nav>
  <main>Saldos y últimos movimientos</main>`;

const credentials = { rut: "12345678-9", password: "clave-de-prueba" };

/**
 * Sesión de navegador falsa sobre happy-dom: el botón de enviar reemplaza el DOM por `afterSubmit`,
 * como hace el portal al navegar. El resto de `Page` que usa `login` se resuelve sin esperar.
 */
function loginSession(start: string, afterSubmit = start): BrowserSession {
  const { page: dom, window } = domPage(start);
  window.document.getElementById("btnLoginRecaptchaV3")?.addEventListener("click", () => {
    window.document.body.innerHTML = afterSubmit;
  });
  const input = { click: async () => {}, type: async () => {} };
  const has = (selector: string) => window.document.querySelector(selector) !== null;
  const page = {
    evaluate: dom.evaluate,
    goto: async () => null,
    url: () => "https://banco.itau.cl/wps/portal/newolb/web/login?token=abc",
    waitForSelector: async (selector: string) => {
      if (!has(selector)) throw new Error("timeout");
    },
    $: async (selector: string) => (has(selector) ? input : null),
    waitForNavigation: async () => null,
    // La espera real reintenta hasta el timeout; aquí la condición se evalúa una sola vez.
    waitForFunction: async (condition: () => unknown) => {
      if (!(await dom.evaluate(condition))) throw new Error("timeout");
    },
  } as unknown as Page;

  return {
    page,
    debugLog: new DebugLog(),
    screenshot: async () => {},
    saveHtml: async () => {},
    progress: () => {},
  } as unknown as BrowserSession;
}

describe("login", () => {
  it("devuelve undefined cuando el portal muestra la sesión iniciada", async () => {
    expect(await login(loginSession(LOGIN_FORM, PORTAL), credentials)).toBeUndefined();
  });

  it("no da por iniciada la sesión si el portal no la muestra, aunque no haya mensaje de error", async () => {
    // El formulario se envía y la página sigue en el login, sin ningún texto reconocible.
    const session = loginSession(LOGIN_FORM);
    const error = await login(session, credentials);

    expect(error).toMatch(/confirmar el inicio de sesión/);
    // Dónde quedó la página sirve para diagnosticar y va al debug log; la query puede traer tokens.
    const debug = session.debugLog.join("\n");
    expect(debug).toContain("/wps/portal/newolb/web/login");
    expect(debug).not.toContain("token=abc");
  });

  it("informa el mensaje del banco cuando rechaza las credenciales", async () => {
    const rejected = `${LOGIN_FORM}<div class="msg-error-input">Clave incorrecta</div>`;

    expect(await login(loginSession(LOGIN_FORM, rejected), credentials)).toContain(
      "Clave incorrecta"
    );
  });

  it("distingue el bloqueo anti-bot de un formulario ausente", async () => {
    const blocked = await login(loginSession("<h1>Access Denied</h1>"), credentials);
    const missing = await login(loginSession("<p>Mantención programada</p>"), credentials);

    expect(blocked).toMatch(/bloque/i);
    expect(missing).toMatch(/campo de RUT/);
  });
});

describe("findLoginError", () => {
  it.each([
    "Clave incorrecta",
    "Rut o clave incorrectos",
    "Cuenta bloqueada",
    "Usuario suspendido",
    "Clave inválida",
  ])("reconoce «%s»", (message) => {
    expect(findLoginError([message])).toBe(message);
  });

  it("ignora los avisos que no hablan de credenciales y devuelve el primero que sí", () => {
    expect(
      findLoginError([
        "Cerraremos tu sesión por inactividad",
        "Clave incorrecta",
        "Cuenta bloqueada",
      ])
    ).toBe("Clave incorrecta");
  });

  it("devuelve undefined cuando no hay mensajes de error", () => {
    expect(findLoginError([])).toBeUndefined();
    expect(findLoginError(["¿Sigues con nosotros?"])).toBeUndefined();
  });
});

describe("hasPortalShell", () => {
  it("reconoce el portal con sesión por su enlace «Cerrar sesión»", async () => {
    expect(await pageFromHtml(PORTAL).evaluate(hasPortalShell)).toBe(true);
  });

  it("no da por iniciada la sesión en la página de login", async () => {
    expect(await pageFromHtml(LOGIN_FORM).evaluate(hasPortalShell)).toBe(false);
  });

  it("no confunde el aviso de inactividad con el enlace de salida", async () => {
    const page = pageFromHtml("<div>Cerraremos tu sesión por inactividad reiterada</div>");

    expect(await page.evaluate(hasPortalShell)).toBe(false);
  });
});
