import type { Page } from "puppeteer-core";
import type { BankMovement, CreditCardBalance } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import type { DebugLog } from "../../core/debug-log.js";
import { normalizeDate, parseChileanAmount } from "../../core/parsing.js";
import { extractAccountMovements } from "../../steps/extraction.js";
import { paginateAndExtract } from "../../steps/pagination.js";
import { normalizeItauBilledRows, normalizeItauCreditCardRows } from "./parse.js";
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
  const balance = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const match = text.match(/Saldo disponible para uso\s*\$\s*([\d.,]+)/);
    if (match) return parseInt(match[1].replace(/[^0-9]/g, ""), 10);
    return undefined;
  });
  if (balance !== undefined) debugLog.push(`  Balance: $${balance.toLocaleString("es-CL")}`);
  return balance;
}

export async function extractMovements(
  page: Page,
  debugLog: DebugLog,
  doSaveHtml: (page: Page, name: string) => Promise<void>
): Promise<BankMovement[]> {
  debugLog.step("Extracting movements...");
  await openAccountMovements(page);

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

export async function extractCreditCardData(
  page: Page,
  debugLog: DebugLog,
  doSaveHtml: (page: Page, name: string) => Promise<void>
): Promise<{ movements: BankMovement[]; creditCards: CreditCardBalance[] }> {
  debugLog.step("Extracting credit card data...");
  const movements: BankMovement[] = [];
  const creditCards: CreditCardBalance[] = [];

  await openCreditCardDebt(page);
  await doSaveHtml(page, "08-tc-deuda");

  const tcInfo = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const cardMatch = text.match(/(Mastercard|Visa)\s+[\w\s]+\*{4}\s*\*{4}\s*\*{4}\s*(\d{4})/i);
    const label = cardMatch
      ? cardMatch[0]
          .replace(/\*{4}\s*\*{4}\s*\*{4}\s*/, "****")
          .replace(/\s+/g, " ")
          .trim()
      : null;
    const nacSection =
      text.match(/Nacional[\s\S]*?(?=Internacional|Ofertas|Movimientos|$)/)?.[0] || "";
    const nacDisponible = nacSection.match(/Cupo disponible\s*\$\s*([\d.]+)/);
    const nacUtilizado = nacSection.match(/Cupo utilizado\s*(?:[\s\S]*?\$\s*([\d.]+))?/);
    const intSection =
      text.match(/Internacional[\s\S]*?(?=Ofertas|Movimientos|Emergencias|$)/)?.[0] || "";
    const intUsdValues = [...intSection.matchAll(/USD\$?\s*(-?[\d.,]+)/g)].map((m) => m[1]);
    const proxFactMatch = text.match(/Próxima facturación\s*(\d{2}\/\d{2}\/\d{4})/);
    return {
      label,
      nacDisponible: nacDisponible?.[1],
      nacUtilizado: nacUtilizado?.[1],
      intDisponible: intUsdValues[2] || null,
      intUtilizado: intUsdValues[1] || null,
      intTotal: intUsdValues[0] || null,
      proxFact: proxFactMatch?.[1],
    };
  });

  if (tcInfo.label) {
    const nacUsed = parseChileanAmount(tcInfo.nacUtilizado || "0");
    const nacAvailable = parseChileanAmount(tcInfo.nacDisponible || "0");
    const card: CreditCardBalance = {
      label: tcInfo.label,
      national: { used: nacUsed, available: nacAvailable, total: nacUsed + nacAvailable },
      movements: [],
    };
    if (tcInfo.intDisponible) {
      const parseUsd = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
      card.international = {
        used: Math.abs(parseUsd(tcInfo.intUtilizado || "0")),
        available: parseUsd(tcInfo.intDisponible || "0"),
        total: parseUsd(tcInfo.intTotal || "0"),
        currency: "USD",
      };
    }
    if (tcInfo.proxFact) card.nextBillingDate = normalizeDate(tcInfo.proxFact);
    creditCards.push(card);
  }

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
  await openBilledNational(page);
  await doSaveHtml(page, "08-tc-cuenta-nacional");

  const facturados = await page.evaluate(() => {
    const results: Array<{
      date: string;
      desc: string;
      total: string;
      cuota: string;
      valorCuota: string;
    }> = [];
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
  await openBilledInternational(page);
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

  movements.push(
    ...normalizeItauCreditCardRows(intlBilled, {
      source: MOVEMENT_SOURCE.credit_card_billed,
      currency: "USD",
    })
  );
  debugLog.push(`  Facturados internacionales: ${intlBilled.length}`);

  return { movements, creditCards };
}
