# Contribuir a Open Banking Chile

Queremos que este proyecto cubra todos los bancos de Chile. Si tienes cuenta en un banco que no está soportado, **tu contribución es bienvenida**.

Antes de empezar lee [AGENTS.md](AGENTS.md): describe las capas del código, los comandos y las convenciones que se verifican automáticamente. Y [SECURITY.md](SECURITY.md).

## Agregar un nuevo banco

La plantilla es `src/banks/edwards/`: léela entera antes de empezar. Un banco es un directorio y su `index.ts` solo orquesta etapas:

```
src/banks/mi-banco/
  index.ts        Exporta el BankScraper y encadena las etapas con runScraper()
  login.ts        login(session, options) → mensaje de error o undefined
  navigation.ts   Cómo llegar a cada sección del portal
  pagination.ts   Solo si el portal pagina distinto a steps/pagination
  parse.ts        Solo si el banco entrega API/JSON propio: funciones puras raw → BankMovement[]
  *.test.ts       Parseo y extracción contra fixtures
```

### 1. Crea el scraper

```ts
// src/banks/mi-banco/index.ts
import type { BankScraper, ScrapeResult, ScraperOptions } from "../../core/types.js";
import { runScraper } from "../../browser/scraper-runner.js";
import type { BrowserSession } from "../../browser/browser.js";
import { failScrape } from "../../browser/result.js";
import { login, BANK_URL } from "./login.js";

const BANK_ID = "mi-banco"; // identificador único, minúsculas, sin espacios

async function scrapeMiBanco(
  session: BrowserSession,
  options: ScraperOptions
): Promise<ScrapeResult> {
  const { debugLog, progress } = session;

  const loginError = await login(session, options);
  if (loginError) return failScrape(session, BANK_ID, loginError);

  debugLog.step("Leyendo movimientos...");
  progress("Leyendo movimientos...");
  const movements = []; // BankMovement[]

  return {
    success: true,
    bank: BANK_ID,
    accounts: [{ label: "Cuenta Corriente ****1234", balance: 1234567, movements }],
    debug: debugLog.join("\n"),
  };
}

const miBanco: BankScraper = {
  id: BANK_ID,
  name: "Mi Banco Chile",
  url: BANK_URL,
  scrape: (options) => runScraper(BANK_ID, options, {}, scrapeMiBanco),
};

export default miBanco;
```

El banco **no** lanza su propio navegador: `runScraper` valida credenciales, abre Chrome, te entrega la `BrowserSession`, hace logout y cierra. Si tu portal necesita opciones especiales (Chrome visible, no cambiar el User-Agent), pásalas como tercer argumento (`{ forceHeadful: true }`, ver `bestado` e `itau`).

### 2. Regístralo

En `src/registry.ts`: el import y una entrada en la lista `all`. De ahí se derivan `banks`, `getBank` y `listBanks`, y `registry.test.ts` falla si un directorio de `src/banks/` queda sin registrar.

```ts
import miBanco from "./banks/mi-banco/index.js"; // ← agregar (y `miBanco` en la lista `all`)
```

### 3. Variables para probarlo

Agrega `MI_BANCO_RUT` y `MI_BANCO_PASS` a `.env.example` (las lee `npm run smoke`; la librería no lee el entorno).

### 4. Pruébalo contra el banco real

```bash
npm run build
npm run smoke -- mi-banco --screenshots
```

Sigue el flujo de [AGENTS.md](AGENTS.md#flujo-de-desarrollo-de-scrapers): llega a la página, guarda el HTML con `--screenshots`, analízalo y recién ahí implementa.

### 5. Agrega tests

- **Respuestas de API**: una función pura en `parse.ts` que normaliza el JSON a `BankMovement[]`, con tests unitarios.
- **DOM**: extrae en una función que solo lea la página con `evaluate` y pruébala offline con un fixture HTML (`pageFromHtml` y `readFixture` de `src/testing/dom.ts`; ejemplo en `src/steps/extraction.test.ts`). Los fixtures son **sintéticos o anonimizados**: nunca una captura real.
- **Contrato**: toda función que produzca movimientos pasa por `expectMovementContract` (`src/testing/movement-contract.ts`; ejemplo en `src/banks/bci/contract.test.ts`).

### 6. Documenta y verifica

Agrega tu banco a la tabla del README y corre el gate completo:

```bash
npm run verify
```

Verifica tipos, lint, reglas de arquitectura (capas y convenciones), código muerto, duplicación, formato, tests y el paquete empaquetado. CI corre exactamente lo mismo.

## El contrato de salida

Lo que devuelve `scrape()` (tipos completos en `src/core/types.ts`) es lo que consumen otras aplicaciones; no se cambia sin coordinar.

```ts
interface ScrapeResult {
  success: boolean;
  bank: string; // ID del banco
  accounts?: AccountBalance[]; // { label?, balance?, movements: BankMovement[] }
  creditCards?: CreditCardBalance[]; // { label, cupos, fechas, movements? }
  error?: string; // si success = false
  screenshot?: string; // base64, para depuración
  debug?: string; // log paso a paso
}

interface BankMovement {
  date: string; // siempre "dd-mm-yyyy"
  description: string;
  amount: number; // número: + abono, − cargo
  balance: number; // saldo posterior (0 si el banco no lo entrega)
  source: "account" | "credit_card_unbilled" | "credit_card_billed";
}
```

## Reglas de seguridad

**CRÍTICO**: lee [SECURITY.md](SECURITY.md) antes de contribuir.

- **NUNCA** incluyas credenciales, screenshots ni datos bancarios reales en commits (tampoco en fixtures).
- **NUNCA** envíes datos a servidores externos: todo corre 100 % local.
- **NUNCA** guardes credenciales en disco: llegan por `ScraperOptions` y viven en memoria.
- Si el banco pide 2FA, espera la aprobación manual (`waitFor2FA`) o devuelve un error claro. No intentes eludir mecanismos de seguridad.

## Tips para scraping de bancos chilenos

1. **Login en 2 pasos**: muchos bancos piden RUT primero y clave después. Maneja ambos flujos.
2. **SPA Angular/React**: no confíes en URLs, navega por clicks.
3. **Popups post-login**: ciérralos siempre (`closePopups`, `dismissBanners`).
4. **Tablas de movimientos**: busca `<th>` con "Fecha", "Cargo", "Abono", "Saldo": es el patrón estándar y `steps/extraction` ya lo resuelve.
5. **Esperas generosas** (2–4 s) entre acciones: los portales son lentos.
6. **Selectores con fallback**: los bancos cambian su HTML. Usa una lista de selectores y prueba en orden:

```ts
const RUT_SELECTORS = ["#id-especifico", 'input[placeholder*="RUT"]', 'input[name*="rut"]'];
```

## Estándares de calidad

- **Multi-cuenta**: si el banco tiene varias cuentas (corriente, vista, ahorro), devuelve **una entrada de `accounts[]` por cuenta**, con su `label`. No elijas por el usuario ni mezcles cuentas en una sola lista.
- **Fecha**: siempre `dd-mm-yyyy` (`normalizeDate` convierte `dd/mm/yyyy`, `yyyy-mm-dd` y `9 mar 2026`).
- **Monto**: número, negativo para cargos y positivo para abonos (`parseChileanAmount`, `parseUsdAmount`).
- **Estados en el README**: `✅ Funcional` solo si devuelve movimientos y saldo; un scraper que solo logra login y saldo se marca `🟡 Solo saldo`.

## Bancos que faltan

Banco Ripley, Banco Consorcio, Coopeuch, Tenpo y Mach. **¿Tienes cuenta en alguno?** ¡Anímate!

## Proceso de review

1. Haz fork y crea una rama: `git checkout -b bank/nombre-banco`.
2. Implementa el scraper siguiendo la plantilla.
3. `npm run verify` debe pasar.
4. Abre un PR indicando qué banco agregaste y cómo lo probaste.

Revisaremos que no haya credenciales ni datos personales, que respete las capas, que los errores se manejen bien (especialmente 2FA) y que el parseo tenga tests.
