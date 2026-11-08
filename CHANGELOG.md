# Changelog

## 3.0.0

### Cambios incompatibles

- **Se eliminó el CLI** (`open-banking-chile` bin, `src/cli.ts`, `dotenv`). Para probar un banco existe `npm run smoke -- <banco>`, solo para desarrollo.
- **La librería ya no lee variables de entorno.** `*_2FA_TIMEOUT_SEC`, `*_MONTHS` y `CENCOSUD_CAPTCHA_TIMEOUT` pasaron a `ScraperOptions`: `twoFactorTimeoutSec`, `historicalMonths` y `captchaTimeoutSec`. Scotiabank: `historicalMonths: 0` ahora significa «sin periodos extra» (antes `SCOTIABANK_MONTHS=0` daba 3).
- **`ScrapeResult.movements` y `ScrapeResult.balance` se eliminaron** (estaban `@deprecated`). Usa `accounts[i].movements` y `accounts[i].balance`.
- **Sin exports nombrados por banco** (`import { falabella } from "open-banking-chile"`): usa `getBank(id)`. `banks`, `getBank` y `listBanks` se derivan de `src/registry.ts`.
- **Node >= 20** (antes 18).
- **`dist/` no se construye al instalar** (se quitó `prepare`): construye con `npm run build`. Se eliminó la dependencia `xlsx`, que no se usaba.

### Corregido

- **Fechas**: Santander (cuenta y TC facturada) y BCI emitían `yyyy-mm-dd`; ahora todas las fechas son `dd-mm-yyyy`. `normalizeDate` acepta ISO con o sin hora.
- **Banco Security** devolvía los movimientos en el campo raíz deprecated y no en `accounts[]`.
- **Cuotas**: `normalizeInstallments` entrega siempre `NN/NN` o `undefined` (BICE emitía `"3 de 12"`, Cencosud podía emitir `"3 Cuotas"`).
- **Falabella**: se descartan las filas de cuenta con monto 0.
- **BCI**: el cupo internacional en USD conserva los decimales (`USD 10,50` ya no pasa a `1050`).
- **Banco de Chile** (detectado en corridas reales):
  - el saldo de cada movimiento de cuenta llegaba como `string`; ahora es `number`;
  - con varias tarjetas sobre la misma cuenta el portal repite la lista completa en cada una; ahora se informa una sola vez (antes se triplicaba);
  - **moneda**: los movimientos internacionales no facturados (origen INT, moneda 840) vienen en USD con decimales y se mostraban como pesos; ahora llevan `currency: "USD"`;
  - **estado de cuenta internacional**: sus movimientos (pagos, compras y comisiones, en USD) nunca se leían porque el código buscaba otras secciones; ahora se informan con `currency: "USD"` y sin las filas de subtotal;
  - una fila del estado nacional sin fecha (algunos avances) lanzaba un error que se tragaba en silencio y cortaba el resto del estado: se perdía una parte de los facturados. Ahora usa la fecha de facturación, el error ya no se oculta (queda en `debug`) y se omiten las filas `TOTAL TARJETA …` que se colaban como movimientos.
- **Itaú** (detectado en corridas reales): el cupo internacional (USD) devolvía `available` y `total` cruzados cuando el cupo estaba en uso (se leía por posición fija y el portal los muestra como disponible, utilizado, total). Ahora se empareja cada valor con su etiqueta.
- Cencosud: el error de CAPTCHA en headless ya no menciona el flag `--headful` del CLI eliminado.

### Añadido

- `AccountBalance` se exporta desde el índice.
- `debugLog.step()` (pasos numerados automáticamente) y `session.progress()` (reemplaza el `onProgress` repetido en cada banco).
- `failScrape()` para los fallos de etapa.
- Arquitectura por capas verificada automáticamente: `banks → steps → browser → core` (dependency-cruiser), más reglas estructurales de ast-grep, oxlint type-aware, knip, jscpd y prettier. `npm run verify` es el gate y corre en CI.
- Tests de contrato de `BankMovement` por banco y tests de extracción del DOM contra fixtures HTML sintéticas (`happy-dom`).

### Interno

- Cada banco es un directorio (`index`, `login`, `navigation`, `parse`, …) siguiendo la plantilla `src/banks/edwards/`.
- `utils.ts` se repartió en `core/`, `browser/` y `steps/`; `actions/` pasó a `steps/` e `infrastructure/` a `browser/`.
- Falabella sigue sobre Playwright (launcher en `src/browser/playwright.ts`); es la única excepción a `runScraper`.
- Itaú: la extracción de los estados de cuenta facturados (nacional e internacional) pasó a `extractBilledRows` y el parseo del resumen de la tarjeta (etiqueta, cupos, próxima facturación) a `parseCreditCardSummary`, función pura sobre el texto de la página. Ambas se prueban contra fixtures/texto sintéticos junto con la cartola de la cuenta. Verificado en vivo: la tabla nacional trae la cuota actual y total (`NN/NN`) en todas las filas facturadas y en las no facturadas que son compras en cuotas.

## 2.0.0

Ver el historial de git.
