import type { Page } from "puppeteer-core";
import { delay } from "../../core/delay.js";

/** Abre el sector de saldos y movimientos de cuentas del portal. */
export async function openMovementsSection(page: Page): Promise<void> {
  const baseUrl = page.url().split("#")[0];
  await page.goto(`${baseUrl}#/movimientos/cuenta/saldos-movimientos`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await delay(5000);
}

/** Cierra el modal promocional que tapa el portal después del login. */
export async function closeWelcomeModal(page: Page): Promise<void> {
  try {
    await page.waitForSelector("#modal_emergente_close, .cdk-overlay-container .btn-no-mas", {
      timeout: 8000,
    });
    await page.evaluate(() => {
      const closeBtn = document.querySelector("#modal_emergente_close") as HTMLElement | null;
      if (closeBtn) {
        closeBtn.click();
        return;
      }
      const noMasBtn = document.querySelector(".btn-no-mas") as HTMLElement | null;
      if (noMasBtn) noMasBtn.click();
    });
    await delay(1500);
  } catch {
    /* no modal */
  }
}
