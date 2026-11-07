# AGENTS.md · open-banking-chile

Librería TypeScript que extrae saldos y movimientos de bancos chilenos con un navegador headless (Puppeteer) y los devuelve como JSON. Cada banco es un módulo que implementa `BankScraper` (`src/core/types.ts`) y se registra en `src/registry.ts`. No hay CLI ni servidor: es una dependencia que se importa (`getBank(id).scrape(options)`). Todo corre en local; las credenciales las recibe el llamador.

Este archivo es la guía única para agentes y contribuyentes (`CLAUDE.md`, `CODEX.md` y `GEMINI.md` apuntan aquí). El detalle para agregar un banco está en `CONTRIBUTING.md`.

## Comandos

| Comando                  | Qué hace                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` / `npm install` | Instala dependencias. No construye: `dist/` se genera con `npm run build`.                                                                                  |
| `npm run build`          | `tsup` → `dist/` (ESM + CJS + `.d.ts`). bort necesita `dist/`: lo construye explícitamente.                                                                 |
| `npm test`               | Tests unitarios (`vitest`).                                                                                                                                 |
| `npm run check`          | Lo estático y los tests: oxlint (type-aware), ast-grep, `tsc`, knip, dependency-cruiser (fronteras), jscpd (duplicación), prettier y `vitest`.              |
| `npm run lint:arch`      | Reglas estructurales de ast-grep (`rules/`, con sus casos en `rule-tests/`): sin pasos de debug numerados a mano y sin aserciones sobre tipos del contrato. |
| `npm run verify`         | **El gate**: `check` más `check:package`. Es lo que corre CI.                                                                                               |
| `npm run check:package`  | Construye, empaqueta, instala el tarball en un proyecto vacío y verifica la API pública en ESM y CJS.                                                       |
| `npm run format`         | Aplica prettier (`.prettierrc` igual al de bort).                                                                                                           |
| `npm run smoke -- <id>`  | Corre el scraper real de un banco y vuelca el JSON. Solo desarrollo; ver abajo.                                                                             |

`npm run smoke -- <id> [--headful] [--screenshots] [--months=N] [--since=dd-mm-yyyy] [--owner=T|A|B]` lee `<ID>_RUT` y `<ID>_PASS` de `.env` (copia `.env.example`; `.env` está ignorado por git). `--screenshots` escribe capturas en `screenshots/` y HTML en `debug/`, ambos ignorados por git y con datos personales: nunca se versionan.

## Uso como librería

```ts
import { getBank } from "open-banking-chile";

const result = await getBank("falabella")!.scrape({ rut: "12345678-9", password: "..." });
```

Opciones en `ScraperOptions` (`src/core/types.ts`): `headful`, `proxyUrl`, `chromePath`, `saveScreenshots`, `since`, `owner`, `onProgress`, `onDebug`, `twoFactorTimeoutSec`, `historicalMonths`, `captchaTimeoutSec`. La librería no lee variables de entorno: toda configuración entra por `ScraperOptions`.

El único consumidor conocido es [bort](../bort) (`getBank(key).scrape({ rut, password, headful, proxyUrl, since, onProgress })`, lee `success`, `error`, `debug`, `accounts[]` y `creditCards[]`). Ese contrato de salida no se rompe sin coordinar un cambio en bort.

## Estructura

Capas: cada una solo conoce las de más abajo (`npm run depcruise` lo hace cumplir).

```
banks → steps → browser → core
```

```
src/
  index.ts                  API pública: getBank(), listBanks(), tipos
  core/                     Puro: sin navegador ni E/S (ni `fs`, ni puppeteer)
    types.ts                Contrato público: BankScraper, ScraperOptions, ScrapeResult, BankMovement…
    parsing.ts              Montos, fechas, RUT, cuotas, titular, resolveMonths
    movements.ts            Deduplicación de movimientos
    debug-log.ts            DebugLog: log con callback y pasos numerados (`step`)
    delay.ts
  browser/                  Ciclo de vida de Chrome (aquí vive el driver)
    browser.ts              launchBrowser → BrowserSession
    scraper-runner.ts       runScraper: credenciales → browser → scrape → logout → cierre
    intercept.ts            Captura de respuestas fetch/XHR de la página
    chrome.ts               findChrome
    artifacts.ts            saveScreenshot / saveHtml (carpeta debug/)
    logout.ts
  steps/                    Pasos reutilizables sobre una página: login, navigation, extraction,
                            pagination, credit-card, balance, two-factor, popups
  banks/<id>/               Un scraper por banco, todos con la forma de `banks/edwards/` (la plantilla)
  testing/                  Ayudas solo para tests: validador del contrato de BankMovement y `pageFromHtml`
scripts/
  smoke.mjs                 Ejecutor de desarrollo (no se publica)
  check-package.mjs         Verificación del paquete empaquetado
```

## Convenciones

- Identificadores y commits en inglés (conventional commits: `feat(bchile): …`, `fix(itau): …`); documentación en español.
- Todo banco pasa por `runScraper()` y recibe una `BrowserSession`; no lanza su propio navegador. Única excepción: `falabella`, escrito sobre Playwright (el launcher vive en `browser/playwright.ts`) y con su propio ciclo de vida. Portarlo a Puppeteer implica reescribir su capa de locators y solo se puede validar contra el banco real: no se hace sin probarlo en vivo.
- Ni `console.*` ni `process.env` en `src/` (salvo la detección de display en `browser/browser.ts`): se informa con `debugLog`/`onProgress` y se configura con `ScraperOptions`.
- `amount` de un movimiento es un número: positivo = abono, negativo = cargo. Fechas `dd-mm-yyyy`, cuotas `NN/NN` o ausentes. Cada banco verifica su salida con `expectMovementContract` en su `contract.test.ts`.
- Los pasos del flujo se registran con `debugLog.step("…")` (numera solo); las líneas de detalle van con `debugLog.push("  → …")`. El avance para el usuario va por `session.progress(…)`.
- Nada de `x as BankMovement` (ni `AccountBalance`, `CreditCardBalance`, `ScrapeResult`): tipa el retorno del `map` y filtra con un predicado de tipo.
- Un scraper no importa a otro scraper; lo compartido vive en `core/`, `browser/` o `steps/`. Un archivo nuevo va en la capa más baja que pueda: si no necesita una página, es `core/`.
- Si el banco pide 2FA, el scraper espera la aprobación manual (`waitFor2FA`) o devuelve un error claro; nunca intenta eludirlo.
- Los tests no tocan bancos reales. La extracción del DOM se prueba offline con fixtures HTML (`pageFromHtml` + `readFixture`, en `__fixtures__/` junto al test; ver `src/steps/extraction.test.ts`): sintéticas o anonimizadas, nunca capturas reales con datos personales. Las respuestas de API se prueban con la función pura que las normaliza.

## Agregar un banco

Sigue `src/banks/edwards/` (la plantilla): el `index.ts` solo orquesta y cada etapa vive en su archivo.

```
banks/<id>/
  index.ts        Exporta el BankScraper y encadena las etapas con runScraper()
  login.ts        login(session, options) → mensaje de error o undefined
  navigation.ts   Cómo llegar a cada sección del portal
  pagination.ts   Solo si el portal pagina distinto a steps/pagination
  parse.ts        Solo si el banco entrega API/JSON propio: funciones puras raw → BankMovement[]
  *.test.ts       Parseo y extracción contra fixtures; `contract.test.ts` verifica el contrato de BankMovement
```

1. Un fallo de etapa se devuelve con `failScrape(session, id, mensaje)` (`browser/result.ts`).
2. Regístralo en `src/registry.ts` (el import y una entrada en la lista). `registry.test.ts` falla si un directorio de `src/banks/` no está registrado.
3. Agrega sus variables `<ID>_RUT`/`<ID>_PASS` a `.env.example`.
4. Detalles y plantilla de código: `CONTRIBUTING.md`.

## Flujo de desarrollo de scrapers

Al extender un scraper (por ejemplo Banco Edwards o Banco de Chile):

1. **Llegar al punto** — corre `npm run build && npm run smoke -- <id> --screenshots` y alcanza la página objetivo (por ejemplo el dashboard tras el login).
2. **Guardar la página** — con `--screenshots` el HTML queda en `debug/*.html`.
3. **Analizar el HTML** — identifica selectores, etiquetas de menú y estructura.
4. **Implementar** — ajusta la navegación o la extracción según lo observado.
5. **Repetir** — vuelve a correr el scraper y pasa al siguiente paso (por ejemplo la página de movimientos).

No te saltes los pasos 2 y 3: no implementes sin inspeccionar antes el HTML guardado.

## Seguridad

- Todo es local: sin servidores externos; las credenciales las provee el llamador.
- Capturas y HTML de depuración contienen datos personales: ignorados por git, nunca se suben.
- Nunca se commitean valores reales de `.env`.
