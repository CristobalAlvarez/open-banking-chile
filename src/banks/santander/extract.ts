import type { Page } from "puppeteer-core";
import type { BankMovement } from "../../core/types.js";
import type { DebugLog } from "../../core/debug-log.js";
import type { Interceptor } from "../../browser/intercept.js";
import { extractAccountMovements } from "../../steps/extraction.js";
import { paginateAndExtract } from "../../steps/pagination.js";
import { clickTcTab, extractCreditCardMovements } from "../../steps/credit-card.js";
import type { MovementAccount } from "./navigation.js";
import { navigateToCreditCardSection, selectMovementAccount } from "./navigation.js";
import {
  normalizeSantanderBilledApiMovements,
  normalizeSantanderCheckingApiMovements,
  normalizeSantanderUnbilledApiMovements,
} from "./parse.js";

/** Movimientos de cuenta: primero la API interceptada y, si no hay datos, el HTML. */
export async function collectAccountMovements(
  page: Page,
  interceptor: Interceptor,
  accounts: MovementAccount[],
  debugLog: DebugLog
): Promise<BankMovement[]> {
  let movements: BankMovement[] = [];

  // Try API interception for checking account
  const checkingCaptures = await interceptor.waitFor("santander-checking", 10_000);
  if (checkingCaptures.length > 0) {
    debugLog.push(`  Checking API: ${checkingCaptures.length} response(s) captured`);
    const apiMovements = normalizeSantanderCheckingApiMovements(checkingCaptures);
    debugLog.push(`  Checking API movements: ${apiMovements.length}`);
    if (apiMovements.length > 0) {
      movements.push(...apiMovements);
    }
  }

  if (movements.length === 0) {
    debugLog.push("  Checking API: no data, falling back to HTML extraction");
    if (accounts.length <= 1) {
      movements = await paginateAndExtract(page, extractAccountMovements, debugLog);
    } else {
      for (const account of accounts) {
        const switched = await selectMovementAccount(page, account.index);
        if (!switched) {
          debugLog.push(`  Could not switch to ${account.label}`);
          continue;
        }
        const acctMovements = await paginateAndExtract(page, extractAccountMovements, debugLog);
        movements.push(...acctMovements);
        debugLog.push(`  ${account.label}: ${acctMovements.length} movement(s)`);
      }
    }
  }

  return movements;
}

/** Movimientos de tarjeta: cada pestaña intenta la API interceptada y cae al HTML si no hay datos. */
export async function collectCreditCardMovements(
  page: Page,
  interceptor: Interceptor,
  debugLog: DebugLog
): Promise<BankMovement[]> {
  const movements: BankMovement[] = [];

  const tcReady = await navigateToCreditCardSection(page, debugLog);
  if (tcReady) {
    if (await clickTcTab(page, "movimientos por facturar")) {
      const unbilledCaptures = await interceptor.waitFor("santander-credit-card-unbilled", 10_000);
      if (unbilledCaptures.length > 0) {
        const unbilledMovements = normalizeSantanderUnbilledApiMovements(unbilledCaptures);
        movements.push(...unbilledMovements);
        debugLog.push(`  CC API (unbilled): ${unbilledMovements.length} movement(s)`);
      } else {
        debugLog.push("  CC API (unbilled): no data, falling back to HTML extraction");
        const unbilled = await extractCreditCardMovements(page, "unbilled");
        movements.push(...unbilled);
        debugLog.push(`  TC por facturar: ${unbilled.length} movement(s)`);
      }
    }
    if (await clickTcTab(page, "movimientos facturados")) {
      const billedCaptures = await interceptor.waitFor("santander-credit-card-billed", 10_000);
      if (billedCaptures.length > 0) {
        const billedMovements = normalizeSantanderBilledApiMovements(billedCaptures);
        movements.push(...billedMovements);
        debugLog.push(`  CC API (billed): ${billedMovements.length} movement(s)`);
      } else {
        debugLog.push("  CC API (billed): no data, falling back to HTML extraction");
        const billed = await extractCreditCardMovements(page, "billed");
        movements.push(...billed);
        debugLog.push(`  TC facturados: ${billed.length} movement(s)`);
      }
    }
  } else {
    debugLog.push("  Could not open credit card section.");
  }

  return movements;
}
