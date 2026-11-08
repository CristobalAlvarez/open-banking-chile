import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";

const PORTAL_BASE = "https://banco.itau.cl/wps/myportal/newolb/web";

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
 * reportar 0 movimientos. Devuelve `false` si el selector no aparece dentro
 * del timeout. No es fatal (una sección sin movimientos puede no pintar la
 * tabla): la extracción sigue y quien llama deja el dato en el debug log.
 */
async function waitForPortalSelector(
  page: Page,
  selector: string,
  timeoutMs = 20000
): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Abre la página de saldos de la cuenta corriente. */
export async function openBalance(page: Page): Promise<void> {
  await gotoPortal(page, `${PORTAL_BASE}/cuentas/cuenta-corriente/saldos`);
  await delay(2000);
}

/** Abre la cartola de últimos movimientos de la cuenta corriente. `false` si no apareció la tabla. */
export async function openAccountMovements(page: Page): Promise<boolean> {
  await gotoPortal(page, `${PORTAL_BASE}/cuentas/cuenta-corriente/saldos-ultimo-movimiento`);
  return waitForPortalSelector(page, '[id$="consultaSaldorecord_table"]');
}

/** Abre el resumen de deuda de la tarjeta de crédito (no facturados). `false` si no hay tablas. */
export async function openCreditCardDebt(page: Page): Promise<boolean> {
  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/deuda`);
  return waitForPortalSelector(
    page,
    '[id$="nacionalesrecord_table"], [id$="internacionalesrecord_table"]'
  );
}

/** Abre el estado de cuenta nacional (movimientos facturados en CLP). `false` si no hay tabla. */
export async function openBilledNational(page: Page): Promise<boolean> {
  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/cuenta-nacional`);
  return waitForPortalSelector(page, 'table[name="operacion_Table"]');
}

/** Abre el estado de cuenta internacional (facturados en USD). `false` si no hay tabla. */
export async function openBilledInternational(page: Page): Promise<boolean> {
  await gotoPortal(page, `${PORTAL_BASE}/tarjeta-credito/resumen/cuenta-internacional`);
  return waitForPortalSelector(page, '[id$="estadoDeCuentaTarjetarecord_table"]');
}
