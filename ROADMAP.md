# Roadmap

Trabajo pendiente conocido. Cada punto dice qué falta y qué lo bloquea.

## Falabella: portar de Playwright a Puppeteer

**Estado:** pendiente, bloqueado por validación real.

Falabella es el único banco que no pasa por `runScraper`/`BrowserSession`: usa Playwright (`playwright-core`) con su propio ciclo de vida. Hoy esa excepción está contenida:

- el launcher vive en `src/browser/playwright.ts` (único sitio fuera de Puppeteer que importa el driver);
- la regla `banks-use-scraper-runner` de dependency-cruiser exceptúa `src/banks/falabella/` de forma explícita;
- el resto del banco ya sigue la plantilla `src/banks/edwards/` y tiene tests de parseo y extracción.

**Qué implicaría portarlo**

- Reescribir la capa de interacción: `getByRole`, `.or()`, `.first()`, `isVisible({ timeout })`, `fill`, `waitForLoadState("networkidle")` y los locators con `hasText` no tienen equivalente directo en Puppeteer.
- Pasarlo por `runScraper` (login, navegación y extracción reciben una `BrowserSession`) y quitar `playwright-core`, `src/browser/playwright.ts` y la excepción de dependency-cruiser.
- Quitar la mención a Playwright de `AGENTS.md` y del `Dockerfile` de bort.

**Por qué no se hizo:** el commit que lo pasó a Playwright no documenta una razón técnica, pero la reescritura solo se puede validar contra el banco real (login en dos pasos, shadow DOM de CMR, paginación de facturados) y hoy no hay cuenta para probarlo.

**Para retomarlo:** tener una cuenta Falabella con CMR, correr `npm run smoke -- falabella` antes y después del port y comparar el JSON (cuentas, movimientos, cupos).

## Bancos por agregar

Banco Ripley, Banco Consorcio, Coopeuch, Tenpo y Mach. Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Puntos que requieren la página real

Hallazgos de la refactorización que no se corrigieron porque hace falta ver el portal:

- **BCI:** el cupo de la tarjeta se lee una vez y se aplica a todas las tarjetas; no hay cupo por tarjeta.
- **Scotiabank:** el detector de 2FA busca `"token"` en todo el HTML de la página y puede dar falsos positivos.
