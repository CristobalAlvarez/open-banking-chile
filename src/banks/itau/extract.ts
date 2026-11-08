import type { Page } from "puppeteer-core";
import type { BankMovement, CreditCardBalance } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import type { DebugLog } from "../../core/debug-log.js";
import { extractAccountMovements } from "../../steps/extraction.js";
import { paginateAndExtract } from "../../steps/pagination.js";
import {
  normalizeItauBilledRows,
  normalizeItauCreditCardRows,
  parseCreditCardSummary,
  parseItauBalance,
} from "./parse.js";
import {
  openAccountMovements,
  openBalance,
  openBilledInternational,
  openBilledNational,
  openCreditCardDebt,
} from "./navigation.js";

export async function extractBalance(
  page: Page,
  debugLog: DebugLog,
  doSaveHtml: (page: Page, name: string) => Promise<void>
): Promise<number | undefined> {
  debugLog.step("Extracting balance...");
  await openBalance(page);
  await doSaveHtml(page, "06-balance");
  const balance = parseItauBalance(await page.evaluate(() => document.body?.innerText || ""));
  if (balance !== undefined) debugLog.push(`  Balance: $${balance.toLocaleString("es-CL")}`);
  return balance;
}

export async function extractMovements(
  page: Page,
  debugLog: DebugLog,
  doSaveHtml: (page: Page, name: string) => Promise<void>
): Promise<BankMovement[]> {
  debugLog.step("Extracting movements...");
  if (!(await openAccountMovements(page))) {
    debugLog.push("  La cartola no cargó: no apareció la tabla de movimientos");
  }

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

export async function extractUnbilledRows(
  page: Page,
  kind: "national" | "international"
): Promise<BankMovement[]> {
  const rows = await page.evaluate(
    (cells, tableKind) => {
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
      const results: Array<{
        date: string;
        desc: string;
        amount: string;
        isCredit: boolean;
        installments: string;
      }> = [];
      if (!table) return results;
      for (const row of table.querySelectorAll("tr")) {
        const dateEl = row.querySelector(`[name="${cells.date}"]`) as HTMLElement | null;
        const postDateEl = row.querySelector(`[name="${cells.postDate}"]`) as HTMLElement | null;
        const descEl = row.querySelector(`[name="${cells.desc}"]`) as HTMLElement | null;
        const amountEl = row.querySelector(`[name="${cells.amount}"]`) as HTMLElement | null;
        const installmentsEl = row.querySelector(
          `[name="${cells.installments}"]`
        ) as HTMLElement | null;
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
    },
    UNBILLED_CELLS,
    kind
  );

  return normalizeItauCreditCardRows(rows, {
    source: MOVEMENT_SOURCE.credit_card_unbilled,
    currency: kind === "international" ? "USD" : "CLP",
  });
}

// ─── Itaú TC: movimientos facturados ─────────────────────────────
//
// El estado de cuenta nacional (CLP) es la tabla `operacion_Table`, de 8 columnas fijas:
// Lugar | Fecha operación | Código referencia | Descripción | Monto Operación |
// Monto total a pagar | N° cuota | Valor cuota. Entre las filas de datos van filas de
// título de sección con una sola celda (se descartan por tener menos de 8). "N° cuota"
// llega como `actual/total` sin relleno ("01/1" = pago único, "06/10") y se normaliza a NN/NN.
// El estado de cuenta internacional (USD) no tiene columna de cuotas.

export async function extractBilledRows(
  page: Page,
  kind: "national" | "international"
): Promise<BankMovement[]> {
  if (kind === "international") {
    const intlRows = await page.evaluate((cells) => {
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

    return normalizeItauCreditCardRows(intlRows, {
      source: MOVEMENT_SOURCE.credit_card_billed,
      currency: "USD",
    });
  }

  const rows = await page.evaluate(() => {
    const results: Array<{
      date: string;
      desc: string;
      total: string;
      cuota: string;
      valorCuota: string;
    }> = [];
    const table = document.querySelector('table[name="operacion_Table"]');
    const trs = table ? table.querySelectorAll("tbody tr") : [];
    for (const row of trs) {
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

  return normalizeItauBilledRows(rows);
}

export async function extractCreditCardData(
  page: Page,
  debugLog: DebugLog,
  doSaveHtml: (page: Page, name: string) => Promise<void>
): Promise<{ movements: BankMovement[]; creditCards: CreditCardBalance[] }> {
  debugLog.step("Extracting credit card data...");
  const movements: BankMovement[] = [];
  const creditCards: CreditCardBalance[] = [];

  if (!(await openCreditCardDebt(page))) {
    debugLog.push("  Deuda: no apareció ninguna tabla de movimientos no facturados");
  }
  await doSaveHtml(page, "08-tc-deuda");

  // El parseo del resumen (etiqueta, cupos, próxima facturación) es una función pura sobre
  // el texto visible; así se prueba offline (ver `parseCreditCardSummary`).
  const summaryText = await page.evaluate(() => document.body?.innerText || "");
  const card = parseCreditCardSummary(summaryText);
  if (card) creditCards.push(card);

  // No facturados: la internacional (USD) no se pagina; la nacional (CLP) usa
  // el widget Dojo que re-renderiza la tabla al clickear a[name="nextbtn"].
  const internationalUnbilled = await extractUnbilledRows(page, "international");
  movements.push(...internationalUnbilled);
  debugLog.push(`  No-facturados internacionales: ${internationalUnbilled.length}`);

  const unbilled = await paginateAndExtract(
    page,
    (p) => extractUnbilledRows(p, "national"),
    debugLog,
    {
      nextSelector: 'a[name="nextbtn"]',
      waitForRefreshSelector: `[name="${UNBILLED_CELLS.date}"]`,
      onPage: (p, pageNumber) => doSaveHtml(p, `08-tc-deuda-p${pageNumber}`),
    }
  );
  movements.push(...unbilled);
  debugLog.push(`  No-facturados: ${unbilled.length}`);

  // Facturados
  if (!(await openBilledNational(page))) {
    debugLog.push("  Estado de cuenta nacional: no apareció la tabla de movimientos");
  }
  await doSaveHtml(page, "08-tc-cuenta-nacional");
  const billed = await extractBilledRows(page, "national");
  movements.push(...billed);
  debugLog.push(`  Facturados: ${billed.length}`);

  // Facturados internacionales (USD): tabla propia del estado de cuenta internacional.
  if (!(await openBilledInternational(page))) {
    debugLog.push("  Estado de cuenta internacional: no apareció la tabla de movimientos");
  }
  await doSaveHtml(page, "08-tc-cuenta-internacional");
  const intlBilled = await extractBilledRows(page, "international");
  movements.push(...intlBilled);
  debugLog.push(`  Facturados internacionales: ${intlBilled.length}`);

  return { movements, creditCards };
}
