import type { Page } from "playwright-core";
import type { DebugLog } from "../../core/debug-log.js";
import type { BankMovement, CreditCardBalance } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import { deduplicateAcrossSources, deduplicateMovements } from "../../core/movements.js";
import { monthYearLabel, normalizeDate, parseChileanAmount } from "../../core/parsing.js";
import { screenshotIfEnabled } from "../../browser/playwright.js";
import { CMR_WAIT_MS, openCmrCard, waitForCmrContent } from "./navigation.js";
import { paginateCmrMovements } from "./pagination.js";
import { extractCardMask, tagCardMovements } from "./parse.js";

export async function scrapeCmrCard(
  page: Page,
  debugLog: DebugLog,
  doScreenshots: boolean,
  progress: (s: string) => void,
  ownerFilter: string
): Promise<{ movements: BankMovement[]; creditCard: CreditCardBalance }> {
  const creditCard: CreditCardBalance = { label: "CMR" };
  const allMovements: BankMovement[] = [];

  debugLog.step("[CMR] Looking for CMR card...");
  progress("Navegando a tarjeta de crédito...");

  // Extract cupos from dashboard
  const cupoData = await extractCupos(page, debugLog);
  if (cupoData) Object.assign(creditCard, cupoData);

  if (!(await openCmrCard(page, debugLog, doScreenshots, ownerFilter))) {
    return { movements: [], creditCard };
  }

  // ── No facturados (default tab) ────────────────────────────────
  debugLog.step("[CMR] Extracting unbilled movements...");
  progress("Extrayendo movimientos TC por facturar...");

  // Extract billing period info
  const unbilledInfo = await extractUnbilledPeriodInfo(page);
  if (unbilledInfo.nextBillingDate)
    creditCard.nextBillingDate = normalizeDate(unbilledInfo.nextBillingDate);
  if (unbilledInfo.nextDueDate) creditCard.nextDueDate = normalizeDate(unbilledInfo.nextDueDate);
  if (unbilledInfo.periodExpenses !== undefined)
    creditCard.periodExpenses = unbilledInfo.periodExpenses;

  const unbilledMovements = await paginateCmrMovements(
    page,
    MOVEMENT_SOURCE.credit_card_unbilled,
    debugLog
  );
  debugLog.push(`  Unbilled: ${unbilledMovements.length} movements`);
  allMovements.push(...unbilledMovements);

  await screenshotIfEnabled(page, "07-cmr-no-facturados", doScreenshots, debugLog);

  // ── Facturados tab ─────────────────────────────────────────────
  debugLog.step("[CMR] Switching to facturados tab...");
  progress("Extrayendo movimientos TC facturados...");

  const tabClicked = await clickCmrTab(page, debugLog);
  if (tabClicked) {
    await delay(2000);
    await waitForCmrContent(page, CMR_WAIT_MS);
    await delay(3000);
    await screenshotIfEnabled(page, "07-cmr-facturados", doScreenshots, debugLog);

    // Extract last statement info
    const billedInfo = await extractBilledStatementInfo(page);
    if (billedInfo.billingDate && billedInfo.billedAmount && billedInfo.dueDate) {
      creditCard.lastStatement = {
        billingDate: normalizeDate(billedInfo.billingDate),
        billedAmount: billedInfo.billedAmount,
        dueDate: normalizeDate(billedInfo.dueDate),
        minimumPayment: billedInfo.minimumPayment,
      };
      creditCard.billingPeriod = monthYearLabel(creditCard.lastStatement.billingDate);
    }

    const billedMovements = await paginateCmrMovements(
      page,
      MOVEMENT_SOURCE.credit_card_billed,
      debugLog
    );
    debugLog.push(`  Billed: ${billedMovements.length} movements`);
    allMovements.push(...billedMovements);
  }

  // Tag movements with card mask
  const cardMask = extractCardMask(creditCard.label);
  const tagged = tagCardMovements(allMovements, cardMask);
  creditCard.movements = deduplicateAcrossSources(deduplicateMovements(tagged));

  return { movements: creditCard.movements, creditCard };
}

async function extractCupos(
  page: Page,
  debugLog: DebugLog
): Promise<Partial<CreditCardBalance> | null> {
  try {
    const cupoData = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const labelMatch = text.match(/(CMR\s+\w+(?:\s+\w+)?)\s*\n?\s*[•·*\s]+\s*(\d{4})/i);
      const label = labelMatch ? `${labelMatch[1]} ****${labelMatch[2]}` : "";
      const cupoMatch = text.match(/\$([\d.,]+)\s*\n?\s*Cupo de compras/i);
      const usadoMatch = text.match(/\$([\d.,]+)\s*\n?\s*Cupo utilizado/i);
      const disponibleMatch = text.match(/\$([\d.,]+)\s*\n?\s*Cupo disponible/i);
      return {
        label,
        cupo: cupoMatch?.[1],
        usado: usadoMatch?.[1],
        disponible: disponibleMatch?.[1],
      };
    });
    if (!cupoData.cupo && !cupoData.disponible) return null;
    const total = cupoData.cupo ? parseChileanAmount(cupoData.cupo) : 0;
    const used = cupoData.usado ? parseChileanAmount(cupoData.usado) : 0;
    const available = cupoData.disponible ? parseChileanAmount(cupoData.disponible) : 0;
    debugLog.push(`  CMR cupos: total=$${total}, used=$${used}, available=$${available}`);
    return { label: cupoData.label || "CMR", national: { total, used, available } };
  } catch {
    return null;
  }
}

async function extractUnbilledPeriodInfo(
  page: Page
): Promise<{ nextBillingDate?: string; nextDueDate?: string; periodExpenses?: number }> {
  return page.evaluate((host: string) => {
    const shadowEl = document.querySelector(host) as Element & { shadowRoot?: ShadowRoot };
    const topRoot = shadowEl?.shadowRoot || document;

    function collectAllRoots(root: ShadowRoot | Element): Array<ShadowRoot | Element> {
      const found: Array<ShadowRoot | Element> = [root];
      for (const el of Array.from((root as Element).querySelectorAll("*"))) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) found.push(...collectAllRoots(sr));
      }
      return found;
    }

    function extractFromSameDiv(root: ShadowRoot | Element, label: string): string | undefined {
      for (const div of Array.from((root as Element).querySelectorAll("div"))) {
        const text = div.textContent?.trim() || "";
        if (text.toLowerCase().startsWith(label.toLowerCase())) {
          const rest = text.slice(label.length).trim();
          if (rest) return rest;
        }
      }
      return undefined;
    }

    function parseAmount(text?: string): number | undefined {
      if (!text) return undefined;
      const m = text.match(/\$([\d.,]+)/);
      if (!m) return undefined;
      return parseInt(m[1].replace(/\./g, "").replace(",", ""), 10) || undefined;
    }

    function extractDate(text?: string): string | undefined {
      if (!text) return undefined;
      const m = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      return m ? m[1] : undefined;
    }

    let billingRaw: string | undefined;
    let dueRaw: string | undefined;
    let expensesRaw: string | undefined;

    for (const root of collectAllRoots(topRoot)) {
      if (!billingRaw) billingRaw = extractFromSameDiv(root, "Próxima facturación");
      if (!dueRaw) dueRaw = extractFromSameDiv(root, "Próximo vencimiento");
      if (!expensesRaw) expensesRaw = extractFromSameDiv(root, "Gastos del periodo");
    }

    return {
      nextBillingDate: extractDate(billingRaw),
      nextDueDate: extractDate(dueRaw),
      periodExpenses: parseAmount(expensesRaw),
    };
  }, "credit-card-movements");
}

async function extractBilledStatementInfo(page: Page): Promise<{
  billingDate?: string;
  billedAmount?: number;
  dueDate?: string;
  minimumPayment?: number;
}> {
  return page.evaluate((host: string) => {
    const shadowEl = document.querySelector(host) as Element & { shadowRoot?: ShadowRoot };
    const topRoot = shadowEl?.shadowRoot || document;

    function collectAllRoots(root: ShadowRoot | Element): Array<ShadowRoot | Element> {
      const found: Array<ShadowRoot | Element> = [root];
      for (const el of Array.from((root as Element).querySelectorAll("*"))) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) found.push(...collectAllRoots(sr));
      }
      return found;
    }

    function findNextSiblingValue(
      root: ShadowRoot | Element,
      labelText: string
    ): string | undefined {
      const divs = Array.from((root as Element).querySelectorAll<HTMLElement>("div"));
      for (let i = 0; i < divs.length - 1; i++) {
        if ((divs[i].textContent?.trim() || "").toLowerCase() === labelText.toLowerCase()) {
          const val = divs[i + 1]?.textContent?.trim() || "";
          if (val) return val;
        }
      }
      return undefined;
    }

    function parseAmount(text?: string): number | undefined {
      if (!text) return undefined;
      const m = text.match(/\$([\d.,]+)/);
      if (!m) return undefined;
      return parseInt(m[1].replace(/\./g, "").replace(",", ""), 10) || undefined;
    }

    function extractDate(text?: string): string | undefined {
      if (!text) return undefined;
      const m = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      return m ? m[1] : undefined;
    }

    let billingDate: string | undefined;
    let billedAmount: number | undefined;
    let dueDate: string | undefined;
    let minimumPayment: number | undefined;

    for (const root of collectAllRoots(topRoot)) {
      if (!billingDate)
        billingDate = extractDate(findNextSiblingValue(root, "Fecha de facturación"));
      if (!billedAmount) billedAmount = parseAmount(findNextSiblingValue(root, "Monto facturado"));
      if (!dueDate) dueDate = extractDate(findNextSiblingValue(root, "Fecha de vencimiento"));
      if (!minimumPayment) minimumPayment = parseAmount(findNextSiblingValue(root, "Pago minimo"));
    }

    return { billingDate, billedAmount, dueDate, minimumPayment };
  }, "credit-card-movements");
}

async function clickCmrTab(page: Page, debugLog: DebugLog): Promise<boolean> {
  const result = await page.evaluate(
    ({ host, radioId }: { host: string; radioId: string }) => {
      const shadowEl = document.querySelector(host) as Element & { shadowRoot?: ShadowRoot };
      const roots: Array<Document | ShadowRoot> = [];
      if (shadowEl?.shadowRoot) roots.push(shadowEl.shadowRoot);
      roots.push(document);

      // Try well-known radio id first
      for (const root of roots) {
        const radio = root.querySelector(`#${radioId}`) as HTMLInputElement | null;
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event("change", { bubbles: true }));
          radio.click();
          const label =
            (root.querySelector(`label[for="${radio.id}"]`) as HTMLElement | null) ??
            (radio.closest("label") as HTMLElement | null);
          if (label) label.click();
          return `radio#${radio.id}`;
        }
      }

      // Fallback: find label containing "facturado"
      for (const root of roots) {
        for (const label of Array.from(root.querySelectorAll<HTMLLabelElement>("label"))) {
          if (!label.innerText?.trim().toLowerCase().includes("facturado")) continue;
          const forId = label.getAttribute("for");
          const radio = forId
            ? (root.querySelector(`#${forId}`) as HTMLInputElement | null)
            : (label.querySelector("input[type='radio']") as HTMLInputElement | null);
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            radio.click();
          }
          label.click();
          return `label: "${label.innerText.trim()}"`;
        }
      }
      return null;
    },
    { host: "credit-card-movements", radioId: "invoicedMovements" }
  );

  if (result) debugLog.push(`  CMR: Clicked facturados tab via ${result}`);
  return result !== null;
}
