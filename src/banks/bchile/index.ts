import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { deduplicateMovements, deduplicateAcrossSources } from "../../core/movements.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { closePopups } from "../../steps/popups.js";
import { apiGet } from "./api.js";
import type { ApiProduct } from "./api.js";
import { BANK_ID } from "./constants.js";
import { fetchAccountMovements, fetchCreditCardData } from "./extract.js";
import { login } from "./login.js";
import { closeWelcomeModal } from "./navigation.js";

// ─── Main scrape function ────────────────────────────────────────

async function scrapeBchile(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { saveScreenshots: doScreenshots, since } = options;
  const { page, debugLog, screenshot: doSave, progress } = session;

  progress("Abriendo sitio del banco...");
  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  progress("Sesión iniciada correctamente");

  await closeWelcomeModal(page);
  await closePopups(page);

  // Fetch products & client data
  debugLog.step("Fetching products and client data via API...");
  progress("Obteniendo productos y datos del cliente...");
  let products: { rut: string; nombre: string; productos: ApiProduct[] };
  let clientData: {
    datosCliente: {
      rut: string;
      nombres: string;
      apellidoPaterno: string;
      apellidoMaterno: string;
    };
  };
  try {
    [products, clientData] = await Promise.all([
      apiGet<typeof products>(
        page,
        "selectorproductos/selectorProductos/obtenerProductos?incluirTarjetas=true"
      ),
      apiGet<typeof clientData>(page, "bff-ppersonas-clientes/clientes/"),
    ]);
    debugLog.push(`  Found ${products.productos.length} products`);
  } catch (err) {
    return failScrape(
      session,
      BANK_ID,
      `No se pudo obtener datos: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Balance
  let balance: number | undefined;
  try {
    const saldos = await apiGet<Array<{ moneda: string; tipo: string; disponible: number }>>(
      page,
      "bff-pp-prod-ctas-saldos/productos/cuentas/saldos"
    );
    const clp = saldos.find((s) => s.moneda === "CLP" && s.tipo === "CUENTA_CORRIENTE");
    if (clp) {
      balance = clp.disponible;
      debugLog.push(`  Balance CLP: $${balance}`);
    }
  } catch {
    /* ignore */
  }

  const fullName =
    products.nombre ||
    `${clientData.datosCliente.nombres} ${clientData.datosCliente.apellidoPaterno}`.trim();

  // Account movements
  debugLog.step("Fetching account movements via API...");
  progress("Extrayendo movimientos de cuenta...");
  const acctResult = await fetchAccountMovements(
    page,
    products.productos,
    fullName,
    products.rut,
    debugLog,
    since
  );
  if (balance === undefined && acctResult.balance !== undefined) balance = acctResult.balance;
  debugLog.push(`  Account movements: ${acctResult.movements.length}`);

  // Credit card data
  debugLog.step("Fetching credit card data via API...");
  progress("Extrayendo datos de tarjeta de crédito...");
  const tcResult = await fetchCreditCardData(page, fullName, debugLog);
  debugLog.push(`  TC movements: ${tcResult.movements.length}`);

  // Distribute TC movements into each card's movements array
  for (const cc of tcResult.creditCards) {
    const mask = cc.label.match(/\*{4}\d{4}/)?.[0];
    const cardMovs = mask ? tcResult.movements.filter((m) => m.card === mask) : tcResult.movements;
    cc.movements = deduplicateMovements(deduplicateAcrossSources(cardMovs));
  }

  const totalTc = tcResult.creditCards.reduce((s, cc) => s + (cc.movements?.length ?? 0), 0);
  debugLog.step(`Total: ${acctResult.movements.length} account + ${totalTc} TC movements`);
  progress(`Listo — ${acctResult.movements.length + totalTc} movimientos totales`);

  await doSave(page, "06-final");
  const ss = doScreenshots ? await page.screenshot({ encoding: "base64" }) : undefined;

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ balance, movements: deduplicateMovements(acctResult.movements) }],
    creditCards: tcResult.creditCards.length > 0 ? tcResult.creditCards : undefined,
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

// ─── Export ──────────────────────────────────────────────────────

const bchile: BankScraper = {
  id: BANK_ID,
  name: "Banco de Chile",
  url: "https://portalpersonas.bancochile.cl",
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeBchile),
};

export default bchile;
