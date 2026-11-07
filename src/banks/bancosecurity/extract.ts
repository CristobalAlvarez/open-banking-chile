import type { Page } from "puppeteer-core";
import { normalizeDate, parseChileanAmount } from "../../core/parsing.js";
import type { BankMovement } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";

export async function extractFromContext(ctx: {
  evaluate: Page["evaluate"];
}): Promise<Array<{ date: string; description: string; amount: string; balance: string }>> {
  return ctx.evaluate(() => {
    const results: Array<{ date: string; description: string; amount: string; balance: string }> =
      [];

    for (const table of Array.from(document.querySelectorAll("table"))) {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (rows.length < 2) continue;

      // Accept headers in <th> OR <td> (Banco Security uses <td> for headers)
      let dateIndex = -1,
        descIndex = -1,
        cargoIndex = -1,
        abonoIndex = -1,
        balanceIndex = -1;
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("th, td"));
        if (cells.length < 3) continue;
        const ht = cells.map((c) => (c as HTMLElement).innerText?.trim().toLowerCase() || "");
        if (!ht.some((h) => h === "fecha" || h.startsWith("fecha"))) continue;
        dateIndex = ht.findIndex((h) => h === "fecha" || h.startsWith("fecha"));
        descIndex = ht.findIndex(
          (h) => h.includes("descrip") || h.includes("detalle") || h.includes("glosa")
        );
        cargoIndex = ht.findIndex(
          (h) => h.includes("cargo") || h.includes("débito") || h.includes("debito")
        );
        abonoIndex = ht.findIndex(
          (h) => h.includes("abono") || h.includes("crédito") || h.includes("credito")
        );
        balanceIndex = ht.findIndex((h) => h === "saldo" || h.includes("saldo"));
        break;
      }
      if (dateIndex === -1) continue;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 3) continue;
        const values = cells.map((c) => (c as HTMLElement).innerText?.trim() || "");
        const rawDate = values[dateIndex] || "";
        if (!/\d{1,2}[/.-]\d{1,2}/.test(rawDate)) continue;
        const description = descIndex >= 0 ? values[descIndex] || "" : "";
        const cargo = cargoIndex >= 0 ? values[cargoIndex].replace(/[^\d.,]/g, "") : "";
        const abono = abonoIndex >= 0 ? values[abonoIndex].replace(/[^\d.,]/g, "") : "";
        const balance = balanceIndex >= 0 ? values[balanceIndex] || "" : "";
        let amount = "";
        if (cargo) amount = "-" + cargo;
        else if (abono) amount = abono;
        if (!amount) continue;
        results.push({ date: rawDate, description, amount, balance });
      }
    }

    return results;
  });
}

export async function extractMovements(page: Page): Promise<BankMovement[]> {
  const allRaw: Array<{ date: string; description: string; amount: string; balance: string }> = [];

  // Search main frame + all iframes (movements table is often in an iframe)
  const contexts: Array<{ evaluate: Page["evaluate"] }> = [page];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) contexts.push(frame);
  }
  for (const ctx of contexts) {
    try {
      allRaw.push(...(await extractFromContext(ctx)));
    } catch {
      /* detached */
    }
  }

  const seen = new Set<string>();
  return allRaw
    .map((m): BankMovement | null => {
      const amount = parseChileanAmount(m.amount);
      if (amount === 0) return null;
      return {
        date: normalizeDate(m.date),
        description: m.description,
        amount,
        balance: m.balance ? parseChileanAmount(m.balance) : 0,
        source: MOVEMENT_SOURCE.account,
      };
    })
    .filter((m): m is BankMovement => {
      if (!m) return false;
      const key = `${m.date}|${m.description}|${m.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
