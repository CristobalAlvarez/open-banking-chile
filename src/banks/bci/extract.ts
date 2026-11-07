import type { Frame, Page } from "puppeteer-core";
import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE, type MovementSource } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import { parseChileanAmount, normalizeDate } from "../../core/parsing.js";
import type { DebugLog } from "../../core/debug-log.js";
import { ACCOUNT_SELECT, NEXT_PAGE_TEXTS } from "./constants.js";
import type { BciCupoData } from "./parse.js";

/** Tanto `Page` como `Frame` exponen `evaluate` con la misma firma. */
type DomReader = Pick<Frame, "evaluate">;

export async function extractBalance(frame: DomReader): Promise<number | undefined> {
  return frame.evaluate(() => {
    const el = document.querySelector("#saldoDis + div, .bci-h2-w800");
    if (!el) return undefined;
    const match = (el as HTMLElement).textContent?.trim().match(/\$\s*([\d.]+)/);
    if (match) return parseInt(match[1].replace(/\./g, ""), 10);
    return undefined;
  });
}

export async function extractAccountOptions(
  frame: DomReader
): Promise<Array<{ value: string; label: string }>> {
  return frame.evaluate((sel: string) => {
    const select = document.querySelector(sel) as HTMLSelectElement | null;
    if (!select) return [];
    return Array.from(select.options).map((o) => ({
      value: o.value,
      label: o.textContent?.trim() || "",
    }));
  }, ACCOUNT_SELECT);
}

export async function selectAccount(frame: DomReader, value: string): Promise<void> {
  await frame.evaluate(
    (optionValue: string, sel: string) => {
      const select = document.querySelector(sel) as HTMLSelectElement | null;
      if (!select) return;
      select.value = optionValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
    ACCOUNT_SELECT
  );
}

export async function extractMovementsFromFrame(
  frame: Frame,
  debugLog: DebugLog
): Promise<BankMovement[]> {
  await frame.evaluate(() => {
    for (const opt of document.querySelectorAll("a, button, span, option")) {
      if ((opt as HTMLElement).innerText?.trim() === "50") {
        (opt as HTMLElement).click();
        return;
      }
    }
  });
  await delay(3000);

  const all: BankMovement[] = [];
  for (let pageIndex = 0; pageIndex < 25; pageIndex++) {
    const raw = await frame.evaluate(() => {
      const results: Array<{ date: string; description: string; cargo: string; abono: string }> =
        [];
      for (const row of Array.from(document.querySelectorAll("table tbody tr"))) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 4) continue;
        const date = cells[0].textContent?.trim() || "";
        if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(date)) continue;
        results.push({
          date,
          description: cells[1].textContent?.trim() || "",
          cargo: cells[2].textContent?.trim() || "",
          abono: cells[3].textContent?.trim() || "",
        });
      }
      return results;
    });
    for (const r of raw) {
      const cargoAmount = r.cargo ? parseChileanAmount(r.cargo) : 0;
      const abonoAmount = r.abono ? parseChileanAmount(r.abono) : 0;
      const amount = cargoAmount > 0 ? -cargoAmount : abonoAmount;
      if (amount === 0) continue;
      all.push({
        date: normalizeDate(r.date),
        description: r.description,
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.account,
      });
    }
    debugLog.push(`  Page ${pageIndex + 1}: ${raw.length} raw movements`);

    const hasNext = await frame.evaluate(
      (nextTexts: string[]) => {
        for (const btn of document.querySelectorAll("button, a")) {
          const text = (btn as HTMLElement).innerText?.trim().toLowerCase() || "";
          if (nextTexts.some((t) => text === t || text.includes(t))) {
            if ((btn as HTMLButtonElement).disabled || btn.getAttribute("aria-disabled") === "true")
              return false;
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      },
      [...NEXT_PAGE_TEXTS]
    );
    if (!hasNext) break;
    await delay(3000);
  }
  return all;
}

export async function extractTCMovements(
  frame: Frame,
  tab: string,
  billingType: string,
  source: MovementSource,
  debugLog: DebugLog
): Promise<BankMovement[]> {
  // ── FASE 1: Seleccionar pestaña (Nacional $ / Internacional USD) ────────────
  await frame.evaluate((tabName: string) => {
    for (const el of document.querySelectorAll(
      ".listTab span, .bci-wk-tab span, .listTab a span"
    )) {
      if ((el as HTMLElement).textContent?.trim() === tabName) {
        const anchor = el.closest("a") as HTMLElement | null;
        if (anchor) {
          anchor.click();
          return;
        }
      }
    }
  }, tab);
  await delay(2500);

  // ── FASE 2: Seleccionar tipo de facturación ─────────────────────────────────
  await frame.evaluate((btnText: string) => {
    for (const btn of document.querySelectorAll("button.btn_blue_border, button")) {
      if ((btn as HTMLElement).textContent?.trim() === btnText) {
        (btn as HTMLElement).click();
        return;
      }
    }
  }, billingType);
  await delay(2500);

  // ── Verificar si hay movimientos ────────────────────────────────────────────
  const hasNoMovements = await frame.evaluate(() => {
    const text = (document.body?.innerText || "").toLowerCase();
    return text.includes("no tienes movimientos") || text.includes("sin movimientos");
  });
  if (hasNoMovements) {
    debugLog.push(`    ${tab} / ${billingType}: sin movimientos`);
    return [];
  }

  // ── FASE 3: Paginación robusta ───────────────────────────────────────────────
  const allMovements: BankMovement[] = [];

  for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
    // Estructura real de la tabla (5 columnas):
    //   td[0]  fecha
    //   td[1]  descripción + opcional .cont-circle
    //   td[2]  tipo de tarjeta  ← no se usa
    //   td[3]  div.container_monto > p (monto) + img (alt="Cargo"|"Abono")
    //   td[4]  flecha de detalle  ← ignorar
    const rawRows = await frame.evaluate(() => {
      const results: Array<{
        date: string;
        description: string;
        rawAmount: string;
        isCargo: boolean;
        pendingConfirmation: boolean;
      }> = [];

      const rows = document.querySelectorAll(
        "table.custom-table tbody tr, .wrapper-table table tbody tr"
      );

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) continue;

        const date = cells[0]?.textContent?.trim() ?? "";
        if (!date || !/\d/.test(date)) continue;

        const descP = cells[1]?.querySelector("p.customRow, p:first-child") as HTMLElement | null;
        const description = descP?.textContent?.trim() ?? cells[1]?.textContent?.trim() ?? "";

        const pendingConfirmation = !!cells[1]?.querySelector(".cont-circle");

        const montoCell = cells[3];
        const montoP = montoCell?.querySelector(".container_monto p, p") as HTMLElement | null;
        const rawAmount = montoP?.textContent?.trim() ?? "";

        const img = montoCell?.querySelector("img");
        const isCargo = (img?.getAttribute("alt") ?? "").toLowerCase() === "cargo";

        if (!rawAmount) continue;

        results.push({ date, description, rawAmount, isCargo, pendingConfirmation });
      }
      return results;
    });

    debugLog.push(`    ${tab}/${billingType} página ${pageIndex + 1}: ${rawRows.length} filas`);

    for (const r of rawRows) {
      const absAmount = parseChileanAmount(r.rawAmount);
      if (absAmount === 0) continue;

      allMovements.push({
        date: normalizeDate(r.date),
        description: r.description,
        amount: r.isCargo ? -absAmount : absAmount,
        balance: 0,
        source,
      });
    }

    // Verificar si hay página siguiente
    const canAdvance = await frame.evaluate(() => {
      const btn = document.getElementById("btn-next");
      if (!btn) return false;
      return (
        !btn.classList.contains("disable") &&
        btn.getAttribute("aria-disabled") !== "true" &&
        !(btn as HTMLButtonElement).disabled
      );
    });

    if (!canAdvance) break;

    // frame.click() simula evento real del mouse; Angular ignora el .click()
    // nativo de JS lanzado desde evaluate().
    try {
      await frame.click("#btn-next");
    } catch {
      break;
    }

    // Esperar que la tabla cambie antes de leer la siguiente página
    const lastRow = rawRows[rawRows.length - 1];
    const pageSignature =
      (rawRows[0]?.date ?? "") +
      (rawRows[0]?.rawAmount ?? "") +
      (lastRow?.date ?? "") +
      (lastRow?.rawAmount ?? "");

    const changed = await waitForTableChange(frame, pageSignature, 8000);
    if (!changed) break;
  }

  debugLog.push(`    ${tab} / ${billingType}: ${allMovements.length} movimientos totales`);
  return allMovements;
}

async function waitForTableChange(
  frame: Frame,
  previousSignature: string,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentSignature = await frame.evaluate(() => {
      const rows = document.querySelectorAll(
        "table.custom-table tbody tr, .wrapper-table table tbody tr"
      );
      if (rows.length === 0) return "";
      const first = rows[0].querySelectorAll("td");
      const last = rows[rows.length - 1].querySelectorAll("td");
      return (
        (first[0]?.textContent?.trim() ?? "") +
        (first[3]?.querySelector("p")?.textContent?.trim() ?? "") +
        (last[0]?.textContent?.trim() ?? "") +
        (last[3]?.querySelector("p")?.textContent?.trim() ?? "")
      );
    });

    if (currentSignature && currentSignature !== previousSignature) return true;
    await delay(400);
  }
  return false;
}

export async function extractCreditCardLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selects = document.querySelectorAll("select.tdc");
    if (selects.length === 0) return [];
    return Array.from((selects[0] as HTMLSelectElement).options).map(
      (o) => o.textContent?.trim() || ""
    );
  });
}

export async function extractCupo(frame: DomReader): Promise<BciCupoData> {
  return frame.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const parseAmt = (t: string) => parseInt(t.replace(/[^0-9]/g, ""), 10) || 0;
    // USD con coma decimal y punto de miles ("1.234,56"): se conservan los decimales.
    const parseUsd = (t: string) => {
      const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    };
    const natUsed = bodyText.match(/utilizado\s*(?:nacional)?\s*\$?\s*([\d.]+)/i);
    const natAvail = bodyText.match(/disponible\s*(?:nacional)?\s*\$?\s*([\d.]+)/i);
    const natTotal = bodyText.match(/total\s*(?:nacional)?\s*\$?\s*([\d.]+)/i);
    const intUsed = bodyText.match(/utilizado\s*(?:internacional)?\s*USD?\s*\$?\s*([\d.,]+)/i);
    const intAvail = bodyText.match(/disponible\s*(?:internacional)?\s*USD?\s*\$?\s*([\d.,]+)/i);
    const intTotal = bodyText.match(/total\s*(?:internacional)?\s*USD?\s*\$?\s*([\d.,]+)/i);
    return {
      nationalUsed: natUsed ? parseAmt(natUsed[1]) : 0,
      nationalAvailable: natAvail ? parseAmt(natAvail[1]) : 0,
      nationalTotal: natTotal ? parseAmt(natTotal[1]) : 0,
      internationalUsed: intUsed ? parseUsd(intUsed[1]) : 0,
      internationalAvailable: intAvail ? parseUsd(intAvail[1]) : 0,
      internationalTotal: intTotal ? parseUsd(intTotal[1]) : 0,
    };
  });
}
