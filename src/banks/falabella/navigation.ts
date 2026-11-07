import type { Page } from "playwright-core";
import type { DebugLog } from "../../core/debug-log.js";
import { delay } from "../../core/delay.js";
import { screenshotIfEnabled } from "../../browser/playwright.js";

export const CMR_WAIT_MS = 30_000;

export async function openAccountSection(
  page: Page,
  debugLog: DebugLog,
  doScreenshots: boolean,
  progress: (s: string) => void
): Promise<void> {
  debugLog.step("[Cuenta] Looking for account...");
  progress("Buscando cartola de cuenta...");

  // Try clicking on Cuenta Corriente product card
  const ccLink = page.getByRole("link", { name: /Cuenta Corriente \d/ });
  let navigated = false;

  if (await ccLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await ccLink.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await delay(3000);
    navigated = true;
  }

  if (!navigated) {
    // Fallback: try clicking Cartola/Movimientos text links
    for (const text of ["cartola", "últimos movimientos", "movimientos", "estado de cuenta"]) {
      const link = page
        .locator("a, button, [role='tab']")
        .filter({ hasText: new RegExp(text, "i") })
        .first();
      if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
        try {
          await link.click();
          await delay(4000);
          navigated = true;
          break;
        } catch {
          /* try next */
        }
      }
    }
  }

  if (!navigated) {
    // Try clicking any account-like element
    const acctEl = page
      .locator("a, div, button")
      .filter({ hasText: /cuenta corriente|cuenta vista/i })
      .first();
    if (await acctEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      await acctEl.click();
      await delay(4000);
    }
  }

  await screenshotIfEnabled(page, "05-account-movements", doScreenshots, debugLog);
}

/** Vuelve al dashboard tras la cuenta, cerrando el popup que pueda aparecer. */
export async function goToDashboard(page: Page, dashboardUrl: string): Promise<void> {
  await page.goto(dashboardUrl, { waitUntil: "networkidle" });
  await delay(2000);

  // Close popups again
  try {
    const closeBtn = page.getByRole("button", { name: "cerrar", exact: true });
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) await closeBtn.click();
  } catch {
    /* no popup */
  }
}

export async function waitForCmrContent(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(
      (host: string) => {
        const el = document.querySelector(host) as Element & { shadowRoot?: ShadowRoot };
        if (!el?.shadowRoot) return false;
        function collectAll(root: ShadowRoot | Element): Array<ShadowRoot | Element> {
          const found: Array<ShadowRoot | Element> = [root];
          for (const child of Array.from((root as Element).querySelectorAll("*"))) {
            const sr = (child as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
            if (sr) found.push(...collectAll(sr));
          }
          return found;
        }
        return collectAll(el.shadowRoot).some(
          (r) => (r as Element).querySelectorAll("table tbody tr td").length > 0
        );
      },
      "credit-card-movements",
      { timeout: timeoutMs }
    );
  } catch {
    /* timeout */
  }
  await delay(500);
}

export async function openCmrCard(
  page: Page,
  debugLog: DebugLog,
  doScreenshots: boolean,
  ownerFilter: string
): Promise<boolean> {
  // Click on CMR product card
  const cmrLink = page
    .getByRole("link", { name: /CMR/ })
    .first()
    .or(page.locator("#cardDetail0, [id^='cardDetail']").first())
    .or(page.locator("a, button, div").filter({ hasText: /CMR/i }).first());

  if (!(await cmrLink.isVisible({ timeout: 5000 }).catch(() => false))) {
    debugLog.push("  [CMR] No CMR card found on dashboard");
    return false;
  }

  await cmrLink.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await delay(5000);
  await screenshotIfEnabled(page, "06-cmr-card", doScreenshots, debugLog);

  // Wait for CMR shadow DOM to render
  await waitForCmrContent(page, CMR_WAIT_MS);

  // Owner filter
  if (ownerFilter !== "B") {
    await page.evaluate(
      ({ host, value }: { host: string; value: string }) => {
        const shadowEl = document.querySelector(host) as Element & { shadowRoot?: ShadowRoot };
        const root = shadowEl?.shadowRoot || document;
        const select = root.querySelector(
          "select[name='searchownership']"
        ) as HTMLSelectElement | null;
        if (select) {
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      { host: "credit-card-movements", value: ownerFilter }
    );
    await waitForCmrContent(page, CMR_WAIT_MS);
  }

  return true;
}
