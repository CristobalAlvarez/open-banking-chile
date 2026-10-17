import type { Page } from "puppeteer-core";
import type { AccountBalance, BankMovement, BankScraper, CreditCardBalance, MovementSource, ScrapeResult, ScraperOptions } from "../types.js";
import { MOVEMENT_SOURCE } from "../types.js";
import { closePopups, delay, formatRut, parseChileanAmount, parseUsdAmount, normalizeDate, normalizeInstallments } from "../utils.js";
import { runScraper } from "../infrastructure/scraper-runner.js";
import type { BrowserSession } from "../infrastructure/browser.js";
import { detect2FA, waitFor2FA } from "../actions/two-factor.js";
import { extractAccountMovements } from "../actions/extraction.js";
import { paginateAndExtract } from "../actions/pagination.js";

// ─── Itaú-specific constants ─────────────────────────────────────

const LOGIN_URL = "https://banco.itau.cl/wps/portal/newolb/web/login";
const PORTAL_BASE = "https://banco.itau.cl/wps/myportal/newolb/web";

const TWO_FACTOR_CONFIG = {
  keywords: ["itaú key", "aprueba", "segundo factor", "autoriza"],
  timeoutEnvVar: "ITAU_2FA_TIMEOUT_SEC",
};

// ─── Itaú-specific helpers ───────────────────────────────────────

const LOGIN_FORM_TIMEOUT_MS = 25000;

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
          document.body?.innerText || "",
        ),
      )
      .catch(() => false);
    return blocked ? "blocked" : "timeout";
  }
}

/**
 * Navigates the portal. The IBM WebSphere pages keep long-lived requests open
 * (analytics, polling), so `networkidle2` sometimes never settles on slower
 * hosts and a strict timeout aborts an otherwise successful load. The DOM is
 * ready by then, and every caller waits for the content afterwards, so a
 * timeout here is not fatal.
 */
async function gotoPortal(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  } catch {
    /* page still loads; callers wait for the rendered content */
  }
}

/**
 * Espera a que el portal inserte el fragmento AJAX que contiene una tabla.
 *
 * Los portlets WebSphere llegan después de `gotoPortal` (Dojo los pide al
 * cargar); sin esta espera la extracción puede ver la página sin tablas y
 * reportar 0 movimientos. Si el selector no aparece dentro del timeout se
 * continúa igual: la extracción reportará 0 y quedará en el debug log.
 */
async function waitForPortalSelector(page: Page, selector: string, timeoutMs = 20000): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
  } catch {
    /* extracción reportará 0 */
  }
}

async function itauLogin(
  page: Page,
  rut: string,
  password: string,
  debugLog: string[],
  doSave: (page: Page, name: string) => Promise<void>,
  doSaveHtml: (page: Page, name: string) => Promise<void>,
): Promise<{ success: boolean; error?: string; screenshot?: string }> {
  debugLog.push("1. Navigating to login page...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {
    /* the Imperva challenge/interstitial may never reach networkidle2 */
  });
  await delay(2000);
  await doSave(page, "01-login");
  await doSaveHtml(page, "01-login");

  debugLog.push("2. Waiting for login form...");
  const formState = await waitForLoginForm(page);
  if (formState === "blocked") {
    const ss = await page.screenshot({ encoding: "base64" });
    return {
      success: false,
      error:
        "Itaú bloqueó la sesión (protección anti-bot Imperva): la página de login nunca cargó. " +
        "El scraper debe correr en modo headful (con display/Xvfb) y sin sobreescribir el User-Agent.",
      screenshot: ss as string,
    };
  }
  const rutEl = formState === "ok" ? await page.$("#loginNameID") : null;
  if (!rutEl) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, error: "No se encontró campo de RUT (#loginNameID)", screenshot: ss as string };
  }
  await rutEl.click({ clickCount: 3 });
  await rutEl.type(formatRut(rut), { delay: 45 });

  debugLog.push("3. Filling password...");
  const passEl = await page.$("#pswdId");
  if (!passEl) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, error: "No se encontró campo de clave (#pswdId)", screenshot: ss as string };
  }
  await passEl.click();
  await passEl.type(password, { delay: 45 });

  debugLog.push("4. Submitting login...");
  await doSave(page, "02-pre-submit");
  await page.evaluate(() => { const btn = document.getElementById("btnLoginRecaptchaV3"); if (btn) btn.click(); });
  try { await page.waitForNavigation({ timeout: 20000 }); } catch { /* SPA */ }
  await delay(3000);
  await doSave(page, "03-after-submit");
  await doSaveHtml(page, "03-after-submit");

  // Login error check
  const errorText = await page.evaluate(() => {
    const sels = ['[class*="error"]', '[class*="alert"]', '[role="alert"]', ".msg-error-input"];
    for (const sel of sels) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const t = (el as HTMLElement).innerText?.trim();
        if (t && t.length > 3 && t.length < 300 && (el as HTMLElement).offsetParent !== null) {
          const lower = t.toLowerCase();
          if (lower.includes("incorrecto") || lower.includes("bloqueada") || lower.includes("suspendida") || lower.includes("inválido")) return t;
        }
      }
    }
    return null;
  });
  if (errorText) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, error: `Error de login: ${errorText}`, screenshot: ss as string };
  }

  // 2FA
  if (await detect2FA(page, TWO_FACTOR_CONFIG)) {
    debugLog.push("5. 2FA detected...");
    await doSave(page, "04-2fa");
    const approved = await waitFor2FA(page, debugLog, TWO_FACTOR_CONFIG);
    if (!approved) {
      const ss = await page.screenshot({ encoding: "base64" });
      return { success: false, error: "2FA no fue aprobado a tiempo (Itaú Key)", screenshot: ss as string };
    }
    await delay(3000);
  }

  debugLog.push("5. Login OK!");
  return { success: true };
}

async function extractBalance(page: Page, debugLog: string[], doSaveHtml: (page: Page, name: string) => Promise<void>): Promise<number | undefined> {
  debugLog.push("6. Extracting balance...");
  await gotoPortal(page, `${PORTAL_BASE}/cuentas/cuenta-corriente/saldos`);
  await delay(2000);
  await doSaveHtml(page, "06-balance");
  const balance = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const match = text.match(/Saldo disponible para uso\s*\$\s*([\d.,]+)/);
    if (match) return parseInt(match[1].replace(/[^0-9]/g, ""), 10);
    return undefined;
  });
  if (balance !== undefined) debugLog.push(`  Balance: $${balance.toLocaleString("es-CL")}`);
  return balance;
}

async function extractMovements(page: Page, debugLog: string[], doSaveHtml: (page: Page, name: string) => Promise<void>): Promise<BankMovement[]> {
  debugLog.push("7. Extracting movements...");
  await gotoPortal(page, `${PORTAL_BASE}/cuentas/cuenta-corriente/saldos-ultimo-movimiento`);
  await waitForPortalSelector(page, '[id$="consultaSaldorecord_table"]');

  // Tabla WebSphere: Fecha | Movimientos | Cargos | Abonos | Saldos | Documentos,
  // paginada con el widget Dojo (a[name="nextbtn"]) que re-renderiza la tabla.
  return paginateAndExtract(page, extractAccountMovements, debugLog, {
    nextSelector: 'a[name="nextbtn"]',
    waitForRefreshSelector: '[name="fechaVAlISO"]',
    onPage: (p, pageNumber) => doSaveHtml(p, `07-movements-p${pageNumber}`),
  });
}

// ─── Itaú TC: movimientos no facturados ──────────────────────────
//
// La página de deuda renderiza dos tablas de movimientos no facturados con
// `name=` estables por celda (WebSphere/Dojo): la nacional (CLP, con columna
// de cuotas) y la internacional (USD, sin cuotas). La nacional se detecta por
// `MOLS_NUM_CUOTA`, que solo existe en ella. La nacional se pagina con el
// widget Dojo (a[name="nextbtn"], AJAX sobre la tabla); la internacional no
// tiene paginación propia.

const UNBILLED_CELLS = {
  date: "FECHA_TRANSACCION_iso8601",
  postDate: "FECHA_POSTEO_iso8601",
  desc: "GLOSA_TRANSACCION",
  installments: "MOLS_NUM_CUOTA",
  amount: "MONTO_TRANSACCION_",
} as const;

// Tabla del estado de cuenta internacional (cuenta-internacional): montos en USD,
// sin columna de cuotas.
const INTL_CELLS = {
  date: "Fecha_iso8601",
  desc: "DetalleTransaccion",
  amount: "MontoDolar_iso8601",
} as const;

export interface ItauCreditCardRow {
  date: string;
  desc: string;
  amount: string;
  isCredit: boolean;
  installments?: string;
}

/**
 * Convierte filas simples de TC a movimientos: no facturados nacionales (CLP)
 * e internacionales (USD), y facturados internacionales (USD).
 *
 * El signo sale del monto (negativo = abono) o de la clase de la celda
 * (`cargos`/`abono`). `currency` solo se agrega cuando no es CLP.
 */
export function normalizeItauCreditCardRows(
  rows: ItauCreditCardRow[],
  opts: { source: MovementSource; currency?: "CLP" | "USD" },
): BankMovement[] {
  const currency = opts.currency ?? "CLP";
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const parsed = currency === "USD" ? parseUsdAmount(m.amount) : parseChileanAmount(m.amount);
    if (parsed === 0) continue;
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount: parsed < 0 || m.isCredit ? Math.abs(parsed) : -Math.abs(parsed),
      balance: 0,
      source: opts.source,
      installments: normalizeInstallments(m.installments),
      ...(currency === "USD" ? { currency: "USD" as const } : {}),
    });
  }
  return movements;
}

export interface ItauBilledRow {
  date: string;
  desc: string;
  total: string;
  cuota: string;
  valorCuota: string;
}

/**
 * Convierte filas crudas del estado de cuenta (cuenta nacional) a movimientos.
 *
 * "Valor cuota" es lo que se carga al período; para compras en cuotas es menor
 * que "Monto Operación", que es el total de la operación. Ese total va en
 * totalAmount ("Monto total a pagar") cuando difiere del cargo del período.
 */
export function normalizeItauBilledRows(rows: ItauBilledRow[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const charged = parseChileanAmount(m.valorCuota);
    if (charged === 0) continue;
    const amount = charged > 0 ? -charged : Math.abs(charged);
    const total = parseChileanAmount(m.total);
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_billed,
      installments: normalizeInstallments(m.cuota),
      ...(Math.abs(total) !== Math.abs(charged) ? { totalAmount: Math.abs(total) } : {}),
    });
  }
  return movements;
}

async function extractUnbilledRows(page: Page, kind: "national" | "international"): Promise<BankMovement[]> {
  const rows = await page.evaluate((cells, tableKind) => {
    // La tabla puede venir envuelta por tablas de layout: elegir la más interna
    // (la que "posee" sus celdas) evita duplicar la primera fila. La nacional es
    // la única con columna de cuotas; la internacional trae montos en USD.
    const table = Array.from(document.querySelectorAll("table")).find((t) => {
      const amountCells = Array.from(t.querySelectorAll(`[name="${cells.amount}"]`));
      if (!amountCells.some((el) => el.closest("table") === t)) return false;
      const installmentCells = Array.from(t.querySelectorAll(`[name="${cells.installments}"]`));
      const ownsInstallments = installmentCells.some((el) => el.closest("table") === t);
      return tableKind === "national" ? ownsInstallments : !ownsInstallments;
    });
    const results: Array<{ date: string; desc: string; amount: string; isCredit: boolean; installments: string }> = [];
    if (!table) return results;
    for (const row of table.querySelectorAll("tr")) {
      const dateEl = row.querySelector(`[name="${cells.date}"]`) as HTMLElement | null;
      const postDateEl = row.querySelector(`[name="${cells.postDate}"]`) as HTMLElement | null;
      const descEl = row.querySelector(`[name="${cells.desc}"]`) as HTMLElement | null;
      const amountEl = row.querySelector(`[name="${cells.amount}"]`) as HTMLElement | null;
      const installmentsEl = row.querySelector(`[name="${cells.installments}"]`) as HTMLElement | null;
      const date = ((dateEl || postDateEl)?.innerText || "").trim();
      const amount = (amountEl?.innerText || "").trim();
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || !descEl || !amountEl) continue;
      if (tableKind === "international" && !/^USD/i.test(amount)) continue;
      results.push({
        date,
        desc: (descEl.innerText || "").trim(),
        amount,
        isCredit: amountEl.className.includes("abono"),
        installments: (installmentsEl?.innerText || "").trim(),
      });
    }
    return results;
  }, UNBILLED_CELLS, kind);

  return normalizeItauCreditCardRows(rows, {
    source: MOVEMENT_SOURCE.credit_card_unbilled,
    currency: kind === "international" ? "USD" : "CLP",
  });
}

async function extractCreditCardData(page: Page, debugLog: string[], doSaveHtml: (page: Page, name: string) => Promise<void>): Promise<{ movements: BankMovement[]; creditCards: CreditCardBalance[] }> {
  debugLog.push("8. Extracting credit card data...");
  const movements: BankMovement[] = [];
  const creditCards: CreditCardBalance[] = [];

  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/deuda`);
  await waitForPortalSelector(page, '[id$="nacionalesrecord_table"], [id$="internacionalesrecord_table"]');
  await doSaveHtml(page, "08-tc-deuda");

  const tcInfo = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const cardMatch = text.match(/(Mastercard|Visa)\s+[\w\s]+\*{4}\s*\*{4}\s*\*{4}\s*(\d{4})/i);
    const label = cardMatch ? cardMatch[0].replace(/\*{4}\s*\*{4}\s*\*{4}\s*/, "****").replace(/\s+/g, " ").trim() : null;
    const nacSection = text.match(/Nacional[\s\S]*?(?=Internacional|Ofertas|Movimientos|$)/)?.[0] || "";
    const nacDisponible = nacSection.match(/Cupo disponible\s*\$\s*([\d.]+)/);
    const nacUtilizado = nacSection.match(/Cupo utilizado\s*(?:[\s\S]*?\$\s*([\d.]+))?/);
    const intSection = text.match(/Internacional[\s\S]*?(?=Ofertas|Movimientos|Emergencias|$)/)?.[0] || "";
    const intUsdValues = [...intSection.matchAll(/USD\$?\s*(-?[\d.,]+)/g)].map(m => m[1]);
    const proxFactMatch = text.match(/Próxima facturación\s*(\d{2}\/\d{2}\/\d{4})/);
    return { label, nacDisponible: nacDisponible?.[1], nacUtilizado: nacUtilizado?.[1], intDisponible: intUsdValues[2] || null, intUtilizado: intUsdValues[1] || null, intTotal: intUsdValues[0] || null, proxFact: proxFactMatch?.[1] };
  });

  if (tcInfo.label) {
    const nacUsed = parseChileanAmount(tcInfo.nacUtilizado || "0");
    const nacAvailable = parseChileanAmount(tcInfo.nacDisponible || "0");
    const card: CreditCardBalance = { label: tcInfo.label, national: { used: nacUsed, available: nacAvailable, total: nacUsed + nacAvailable }, movements: [] };
    if (tcInfo.intDisponible) {
      const parseUsd = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
      card.international = { used: Math.abs(parseUsd(tcInfo.intUtilizado || "0")), available: parseUsd(tcInfo.intDisponible || "0"), total: parseUsd(tcInfo.intTotal || "0"), currency: "USD" };
    }
    if (tcInfo.proxFact) card.nextBillingDate = normalizeDate(tcInfo.proxFact);
    creditCards.push(card);
  }

  // No facturados: la internacional (USD) no se pagina; la nacional (CLP) usa
  // el widget Dojo que re-renderiza la tabla al clickear a[name="nextbtn"].
  const internationalUnbilled = await extractUnbilledRows(page, "international");
  movements.push(...internationalUnbilled);
  debugLog.push(`  No-facturados internacionales: ${internationalUnbilled.length}`);

  const unbilled = await paginateAndExtract(page, (p) => extractUnbilledRows(p, "national"), debugLog, {
    nextSelector: 'a[name="nextbtn"]',
    waitForRefreshSelector: `[name="${UNBILLED_CELLS.date}"]`,
    onPage: (p, pageNumber) => doSaveHtml(p, `08-tc-deuda-p${pageNumber}`),
  });
  movements.push(...unbilled);
  debugLog.push(`  No-facturados: ${unbilled.length}`);

  // Facturados
  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/cuenta-nacional`);
  await waitForPortalSelector(page, 'table[name="operacion_Table"]');
  await doSaveHtml(page, "08-tc-cuenta-nacional");

  const facturados = await page.evaluate(() => {
    const results: Array<{ date: string; desc: string; total: string; cuota: string; valorCuota: string }> = [];
    const table = document.querySelector('table[name="operacion_Table"]');
    const rows = table ? table.querySelectorAll("tbody tr") : [];
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 8) continue;
      const dateText = cells[1]?.innerText?.trim() || "";
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) continue;
      results.push({
        date: dateText,
        desc: cells[3]?.innerText?.trim() || "",
        total: cells[5]?.innerText?.trim() || "",
        cuota: cells[6]?.innerText?.trim() || "",
        valorCuota: cells[7]?.innerText?.trim() || "",
      });
    }
    return results;
  });

  movements.push(...normalizeItauBilledRows(facturados));
  debugLog.push(`  Facturados: ${facturados.length}`);

  // Facturados internacionales (USD): tabla propia del estado de cuenta internacional.
  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/cuenta-internacional`);
  await waitForPortalSelector(page, '[id$="estadoDeCuentaTarjetarecord_table"]');
  await doSaveHtml(page, "08-tc-cuenta-internacional");

  const intlBilled = await page.evaluate((cells) => {
    const table = document.querySelector('[id$="estadoDeCuentaTarjetarecord_table"]');
    const results: Array<{ date: string; desc: string; amount: string; isCredit: boolean }> = [];
    if (!table) return results;
    for (const row of table.querySelectorAll("tr")) {
      const dateEl = row.querySelector(`[name="${cells.date}"]`) as HTMLElement | null;
      const descEl = row.querySelector(`[name="${cells.desc}"]`) as HTMLElement | null;
      const amountEl = row.querySelector(`[name="${cells.amount}"]`) as HTMLElement | null;
      const date = (dateEl?.innerText || "").trim();
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date) || !descEl || !amountEl) continue;
      results.push({
        date,
        desc: (descEl.innerText || "").trim(),
        amount: (amountEl.innerText || "").trim(),
        isCredit: amountEl.className.includes("abono"),
      });
    }
    return results;
  }, INTL_CELLS);

  movements.push(...normalizeItauCreditCardRows(intlBilled, { source: MOVEMENT_SOURCE.credit_card_billed, currency: "USD" }));
  debugLog.push(`  Facturados internacionales: ${intlBilled.length}`);

  return { movements, creditCards };
}

// ─── Main scrape function ────────────────────────────────────────

async function scrapeItau(session: BrowserSession, options: ScraperOptions): Promise<ScrapeResult> {
  const { rut, password, saveScreenshots: doScreenshots } = options;
  const { onProgress } = options;
  const { page, debugLog, screenshot: doSave, saveHtml: doSaveHtml } = session;
  const bank = "itau";
  const progress = onProgress || (() => {});

  progress("Abriendo sitio del banco...");
  const loginResult = await itauLogin(page, rut, password, debugLog, doSave, doSaveHtml);
  if (!loginResult.success) {
    return { success: false, bank, accounts: [], error: loginResult.error, screenshot: loginResult.screenshot, debug: debugLog.join("\n") };
  }

  progress("Sesión iniciada correctamente");
  await closePopups(page);

  progress("Extrayendo saldo...");
  const balance = await extractBalance(page, debugLog, doSaveHtml);

  progress("Extrayendo movimientos de cuenta...");
  const accountMovements = await extractMovements(page, debugLog, doSaveHtml);
  progress(`Cuenta: ${accountMovements.length} movimientos`);

  progress("Extrayendo datos de tarjeta de crédito...");
  const tcResult = await extractCreditCardData(page, debugLog, doSaveHtml);

  // extractCreditCardData returns card movements in a separate array. Attach them
  // to their card, otherwise consumers never receive them (bort reads
  // creditCards[].movements). Itaú exposes a single card, so all belong to it.
  const card = tcResult.creditCards[0];
  if (card) {
    const mask = card.label.match(/\*{4}\d{4}/)?.[0];
    if (mask) for (const m of tcResult.movements) m.card = mask;
    card.movements = tcResult.movements;
  }

  const totalTc = card?.movements?.length ?? 0;

  debugLog.push(`9. Total: ${accountMovements.length} account + ${totalTc} TC movements`);
  progress(`Listo — ${accountMovements.length + totalTc} movimientos totales`);
  await doSave(page, "05-final");
  const ss = doScreenshots ? (await page.screenshot({ encoding: "base64" })) as string : undefined;

  const accounts: AccountBalance[] = [{ balance, movements: accountMovements }];
  return { success: true, bank, accounts, creditCards: tcResult.creditCards.length > 0 ? tcResult.creditCards : undefined, screenshot: ss, debug: debugLog.join("\n") };
}

// ─── Export ──────────────────────────────────────────────────────

const itau: BankScraper = {
  id: "itau",
  name: "Itaú",
  url: "https://banco.itau.cl",
  // Itaú sits behind Imperva (reese84): headless Chrome and a User-Agent that
  // doesn't match the installed Chrome build both get the session blocked.
  // Requires a display — on headless Linux use Xvfb (DISPLAY=:99).
  scrape: (options) =>
    runScraper("itau", options, { forceHeadful: true, skipUserAgentOverride: true }, scrapeItau),
};

export default itau;
