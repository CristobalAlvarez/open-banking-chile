import type { BankMovement } from "../../core/types.js";
import { delay } from "../../core/delay.js";
import type { BrowserSession } from "../../browser/browser.js";
import { allDeepJs } from "./deep-dom.js";
import { extractMovements } from "./extract.js";
import { dismissScotiaTutorial } from "./navigation.js";

/**
 * Recorre "Consultar Cartolas" mes a mes desde el panel de cartolas y devuelve los
 * movimientos de los periodos históricos.
 */
export async function fetchHistoricalCartolas(
  session: BrowserSession,
  months: number
): Promise<BankMovement[]> {
  const { page, debugLog, screenshot: doSave, progress } = session;
  const movements: BankMovement[] = [];

  // Navigate to Cartolas via sidebar: Cuentas → Cuenta Corriente → Ver cartolas
  // Step 1: Click "Cuentas" in sidebar
  await page.evaluate(
    new Function(`${allDeepJs()}
      for (const el of allDeep(document, "nav a, nav button, aside a, aside button, a, button, li, span")) {
        const text = el.innerText?.trim().toLowerCase() || "";
        if (text === "cuentas" && text.length < 15) { el.click(); return true; }
      }
      return false;`) as () => boolean
  );
  debugLog.push("  Sidebar: Cuentas");
  await delay(2000);

  // Step 2: Click "Cuenta Corriente" submenu
  await page.evaluate(
    new Function(`${allDeepJs()}
      for (const el of allDeep(document, "a, button, li, span")) {
        const text = el.innerText?.trim().toLowerCase() || "";
        if (text === "cuenta corriente" && text.length < 25) { el.click(); return true; }
      }
      return false;`) as () => boolean
  );
  debugLog.push("  Sidebar: Cuenta Corriente");
  await delay(2000);

  // Step 3: Navigate to Cartolas tab — try URL param change first, then click
  const currentUrl = page.url();
  let clickedVerCartolas = false;

  // Try URL-based navigation (change tab=saldos to tab=cartolas)
  if (currentUrl.includes("tab=saldos") || currentUrl.includes("balancesmovements")) {
    const cartolasUrl = currentUrl.includes("tab=")
      ? currentUrl.replace(/tab=[^&]+/, "tab=cartolas")
      : currentUrl + (currentUrl.includes("?") ? "&" : "?") + "tab=cartolas";
    try {
      await page.goto(cartolasUrl, { waitUntil: "networkidle2", timeout: 15000 });
      clickedVerCartolas = true;
      debugLog.push("  Navigated to Cartolas tab via URL");
    } catch {
      /* fallback below */
    }
  }

  // Fallback: click "Ver cartolas" or "Cartolas" tab
  if (!clickedVerCartolas) {
    clickedVerCartolas = await page.evaluate(
      new Function(`${allDeepJs()}
        for (const el of allDeep(document, "a, button, li, span")) {
          const text = el.innerText?.trim().toLowerCase() || "";
          if (text === "ver cartolas" || text.includes("ver cartola")) { el.click(); return true; }
        }
        return false;`) as () => boolean
    );
  }
  if (!clickedVerCartolas) {
    clickedVerCartolas = await page.evaluate(
      new Function(`${allDeepJs()}
        for (const el of allDeep(document, "a, button, [role='tab'], li, span")) {
          const text = el.innerText?.trim().toLowerCase() || "";
          if (text === "cartolas" && text.length < 20) { el.click(); return true; }
        }
        return false;`) as () => boolean
    );
  }

  if (clickedVerCartolas) {
    debugLog.push("  On Cartolas tab");
    await delay(4000);
    await dismissScotiaTutorial(page, debugLog);

    // Click "Consultar Cartolas" — check main page + all frames
    let clickedConsultar = await page.evaluate(
      new Function(`${allDeepJs()}
        for (const el of allDeep(document, "a, button, span")) {
          const text = el.innerText?.trim().toLowerCase() || "";
          if (text.includes("consultar cartola") && text.length < 40) { el.click(); return true; }
        }
        return false;`) as () => boolean
    );

    // Try frames if not found in main page
    if (!clickedConsultar) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          clickedConsultar = await frame.evaluate(() => {
            for (const el of document.querySelectorAll("a, button, span, div")) {
              const text = (el as HTMLElement).innerText?.trim().toLowerCase() || "";
              if (text.includes("consultar cartola") && text.length < 40) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          });
          if (clickedConsultar) {
            debugLog.push("  Found Consultar Cartolas in iframe");
            break;
          }
        } catch {
          /* detached */
        }
      }
    }

    if (clickedConsultar) {
      debugLog.push("  Clicked: Consultar Cartolas");
      await delay(5000);
      await doSave(page, "06-consultar-cartolas");

      const MONTH_NAMES = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
      ];
      const now = new Date();

      for (let m = 0; m < months; m++) {
        const target = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const targetMonth = target.getMonth(); // 0-based
        const targetYear = target.getFullYear();
        debugLog.push(`  Cartola: ${MONTH_NAMES[targetMonth]} ${targetYear}`);
        progress(`Cartola ${MONTH_NAMES[targetMonth]} ${targetYear}...`);

        // Try to select month/year in dropdowns (check all frames)
        const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
        let submitted = false;

        // Debug: list frames and their select counts
        for (const frame of frames) {
          try {
            const info = await frame.evaluate(() => {
              const selects = document.querySelectorAll("select");
              const inputs = document.querySelectorAll("input");
              const buttons = document.querySelectorAll(
                "button, input[type='submit'], input[type='button'], input[type='image']"
              );
              return {
                url: window.location.href,
                selects: selects.length,
                inputs: inputs.length,
                buttons: buttons.length,
              };
            });
            debugLog.push(
              `    Frame: ${info.url.substring(0, 80)} | selects=${info.selects} inputs=${info.inputs} buttons=${info.buttons}`
            );
          } catch {
            /* detached */
          }
        }

        for (const frame of frames) {
          try {
            // Debug: dump select options
            const selectDebug = await frame
              .evaluate(() => {
                const selects = Array.from(document.querySelectorAll("select"));
                return selects.map((sel, i) => ({
                  index: i,
                  name: sel.name || sel.id,
                  options: Array.from(sel.options).map((o) => ({
                    text: o.text.trim(),
                    value: o.value,
                  })),
                }));
              })
              .catch(() => []);
            if (selectDebug.length > 0) {
              if (selectDebug.length > 0)
                debugLog.push(`    Frame has ${selectDebug.length} selects`);
            }

            const filled = await frame.evaluate(
              (monthIdx: number, year: number) => {
                const selects = Array.from(document.querySelectorAll("select"));
                if (selects.length < 1) return "no selects";

                // Use first two selects directly (month, year)
                const monthSelect = selects[0];
                const yearSelect = selects.length >= 2 ? selects[1] : null;
                if (!yearSelect) return "only 1 select";

                // Set month by value (01-12)
                const monthValue = String(monthIdx + 1).padStart(2, "0");
                monthSelect.value = monthValue;
                monthSelect.dispatchEvent(new Event("change", { bubbles: true }));

                // Set year
                yearSelect.value = String(year);
                yearSelect.dispatchEvent(new Event("change", { bubbles: true }));

                return "ok";
              },
              targetMonth,
              targetYear
            );

            debugLog.push(`    Fill result: ${filled}`);
            if (filled !== "ok") continue;

            await delay(500);

            // Click "Aceptar" (could be button, submit, or image input)
            const accepted = await frame.evaluate(() => {
              for (const el of document.querySelectorAll(
                'button, input[type="submit"], input[type="button"], input[type="image"], a, img'
              )) {
                const text = (
                  (el as HTMLElement).innerText?.trim() ||
                  (el as HTMLInputElement).value ||
                  (el as HTMLInputElement).alt ||
                  ""
                ).toLowerCase();
                if (
                  text.includes("aceptar") ||
                  text === "buscar" ||
                  text === "consultar" ||
                  text === "enviar"
                ) {
                  (el as HTMLElement).click();
                  return text;
                }
              }
              // Last resort: click any submit-like element
              const submit = document.querySelector(
                'input[type="submit"], input[type="image"]'
              ) as HTMLElement;
              if (submit) {
                submit.click();
                return "submit-fallback";
              }
              return null;
            });
            debugLog.push(`    Accepted: ${accepted}`);

            if (accepted) {
              debugLog.push(`    Submitted: ${MONTH_NAMES[targetMonth]} ${targetYear}`);
              await delay(8000);

              // Wait for table to load
              const waitStart = Date.now();
              while (Date.now() - waitStart < 15000) {
                const hasContent = await frame
                  .evaluate(() => {
                    const tables = document.querySelectorAll("table");
                    for (const t of Array.from(tables)) {
                      if (t.querySelectorAll("tr").length > 2) return true;
                    }
                    return false;
                  })
                  .catch(() => false);
                if (hasContent) break;
                await delay(2000);
              }

              await doSave(page, `07-cartola-${MONTH_NAMES[targetMonth]}-${targetYear}`);

              // Extract from this frame
              const periodMovements = await extractMovements(page);
              debugLog.push(`    Found: ${periodMovements.length} movements`);
              movements.push(...periodMovements);
              submitted = true;
              break;
            }
          } catch {
            /* detached frame */
          }
        }

        if (!submitted) {
          debugLog.push(
            `    Could not submit cartola for ${MONTH_NAMES[targetMonth]} ${targetYear}`
          );
          break;
        }
      }
    } else {
      debugLog.push("  Could not click Consultar Cartolas");
    }
  } else {
    debugLog.push("  Could not navigate to Cartolas");
  }

  return movements;
}
