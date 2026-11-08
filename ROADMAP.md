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

## Itaú: pendientes conocidos

**Estado:** funcional (cuenta, saldo y tarjeta nacional e internacional). Lo que sigue falta por decidir, por ver el portal real o por implementar. Límites actuales en el [README](README.md#itaú-alcance-y-límites).

- **Cobertura de `since`** · _requiere la página real._ La cartola que se lee es «Últimos 30 movimientos» y `since` se ignora. bort lo envía y espera líneas `ADVERTENCIA` / `→ cartola` en `debug` (como bchile). Falta explorar «Cartola histórica» (`/cuentas/cuenta-corriente/cartola-historica`) para ver si permite un rango de fechas, y los estados de cuenta anteriores de la tarjeta (hoy solo se lee el último). Mientras tanto, Itaú puede avisar cuando el movimiento más antiguo no alcanza `since`.
- **Tiempo del scrape** · _sin bloqueo, falta implementarlo._ Una corrida toma entre 77 y 84 s; bort declara `maxDuration = 120` en `/api/bank/sync` y da un sync por colgado a los 3 min. Unos 20 s son dos timeouts de 10 s al final de cada paginación: el botón «siguiente» nunca se deshabilita y el paginador dice «N de M». Leer ese «de M» y parar ahí lo evita, y quita el log «loaded page N+1» de una página que no existe.
- **Etiqueta de cuenta, línea de crédito y cuenta en dólares** · _requiere decisión y coordinar con bort._ `accounts[].label` no se informa y bort identifica la cuenta por (conexión, label): ponerlo parte la cuenta existente en dos y hace falta migrarla. La línea de crédito (cupo utilizado y disponible en el home) y la cuenta en dólares no se extraen; falta definir cómo modelarlas (otra entrada en `accounts[]` con su label).
- **Datos del estado de cuenta** · _sin bloqueo._ `lastStatement` (período facturado, «Pagar hasta», monto total facturado, monto mínimo), `nextDueDate` y `billingPeriod` están en `/tarjeta-credito/resumen/cuenta-nacional` y no se informan (bchile y falabella sí). bort hoy no los lee.
- **Filas `00/NN` y cuotas de pago único** · _requiere decisión._ Las filas de la sección 4 del estado de cuenta nacional («Información compras en cuotas en el período», cuota `00/NN`) se informan como facturadas y parecen informativas. Los no facturados de pago único salen sin `installments`: la celda viene vacía y esa tabla no distingue una compra de una comisión.
- **Sin verificar** · _requiere cuenta o entorno._ El 2FA (Itaú Key) no se ha gatillado en las corridas de prueba; con varias tarjetas solo se toma la primera (la cuenta de prueba tiene una y sin selector); el entorno de bort (Alpine, Chromium, Xvfb y proxy), donde Imperva puede comportarse distinto que en una Mac.

## Bancos por agregar

Banco Ripley, Banco Consorcio, Coopeuch, Tenpo y Mach. Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Puntos que requieren la página real

Hallazgos de la refactorización que no se corrigieron porque hace falta ver el portal:

- **BCI:** el cupo de la tarjeta se lee una vez y se aplica a todas las tarjetas; no hay cupo por tarjeta.
- **Scotiabank:** el detector de 2FA busca `"token"` en todo el HTML de la página y puede dar falsos positivos.
