# Open Banking Chile

Scrapers open source para bancos chilenos. Obt??n tus movimientos bancarios y saldo como JSON limpio

> **Disclaimer**: Este proyecto no est?? afiliado con ning??n banco. ??salo bajo tu propia responsabilidad y solo con tus propias credenciales.

## Migraci??n v2 ??? v3

**v3.0.0 introduce un cambio breaking en `ScrapeResult`:**

Los movimientos ya no est??n en un array plano `result.movements` ??? ahora viven dentro de cada cuenta/tarjeta:

| Antes (v2)               | Ahora (v3)                                  |
| ------------------------ | ------------------------------------------- |
| `result.movements`       | `result.accounts[i].movements`              |
| `result.balance`         | `result.accounts[i].balance`                |
| _(no exist??a)_           | `result.creditCards[i].movements`           |

```ts
// v2 (ya no v??lido)
console.log(result.balance);
for (const m of result.movements) { ... }

// v3
const cuenta = result.accounts?.[0];
console.log(cuenta?.balance);
for (const m of cuenta?.movements ?? []) { ... }

// Movimientos de una tarjeta espec??fica
for (const card of result.creditCards ?? []) {
  console.log(card.label, card.movements?.length);
}
```

Los campos `movements` y `balance` en `ScrapeResult` se mantienen como `@deprecated` para compatibilidad temporal.

## Migraci??n v1 ??? v2

**v2.0.0 introduce un cambio breaking en la interfaz `BankMovement`:**

El campo `source` ahora es **obligatorio** e indica el origen del movimiento. Si construyes objetos `BankMovement` manualmente, agrega `source: "account"`. Si solo consumes resultados del scraper, no hay cambios necesarios.

Tambi??n en esta versi??n: utilidades compartidas (`parseChileanAmount`, `normalizeDate`, `deduplicateMovements`, etc.) disponibles como exports desde `open-banking-chile/utils`.

## Bancos soportados

| Banco                             | ID           | Estado       |
| --------------------------------- | ------------ | ------------ |
| Banco Falabella (cuenta + CMR TC) | `falabella`  | ??? Funcional |
| Banco BICE                        | `bice`       | ??? Funcional |
| Banco Santander                   | `santander`  | ??? Funcional |
| Banco Edwards                     | `edwards`    | ??? Funcional |
| Scotiabank                        | `scotiabank` | ??? Funcional |
| Banco de Chile                    | `bchile`     | ??? Funcional |
| BCI                               | `bci`        | ??? Funcional |
| Ita??                              | `itau`       | ??? Funcional |
| Banco Estado (CuentaRUT)          | `bestado`    | ??? Funcional |
| Tarjeta Cencosud                  | `cencosud`   | ??? Funcional |

**??Tu banco no est???** ??? [Contribuir](#contribuir)

## Requisitos

- **Node.js** >= 18
- **Google Chrome** o **Chromium**

```bash
# Instalar Chrome ??? Ubuntu/Debian
sudo apt update && sudo apt install -y google-chrome-stable

# macOS
brew install --cask google-chrome
```

## Instalaci??n

```bash
# Desde GitHub
npm install github:kaihv/open-banking-chile

# O clonar el repo
git clone https://github.com/kaihv/open-banking-chile.git
cd open-banking-chile
npm install
npm run build
```

## Uso

### CLI

Configura tu archivo `.env` con tus credenciales:

```bash
# Banco Falabella
FALABELLA_RUT=12345678-9
FALABELLA_PASS=tu_clave

# Banco BICE
BICE_RUT=12345678-9
BICE_PASS=tu_clave
## Opcional:
BICE_MONTHS=1

# Banco Santander
SANTANDER_RUT=12345678-9
SANTANDER_PASS=tu_clave

# Banco de Chile
BANCOCHILE_RUT=12345678-9
BANCOCHILE_PASS=tu_clave

# Banco Edwards
EDWARDS_RUT=12345678-9
EDWARDS_PASS=tu_clave


# Ita??
ITAU_RUT=12345678-9
ITAU_PASS=tu_clave

# Banco Estado
BESTADO_RUT=12345678-9
BESTADO_PASS=tu_clave

# Tarjeta Cencosud
CENCOSUD_RUT=12345678-9
CENCOSUD_PASS=tu_clave
```

Ejecuta la librer??a con el comando `npx`, `dotenv` incluir?? autom??ticamente las variables de entorno.

```bash

# Consultar banco
npx open-banking-chile --bank falabella --pretty
npx open-banking-chile --bank santander --pretty
npx open-banking-chile --bank bchile --pretty
npx open-banking-chile --bank edwards --pretty
npx open-banking-chile --bank itau --pretty
npx open-banking-chile --bank bestado --pretty
npx open-banking-chile --bank cencosud --pretty

# Solo movimientos
npx open-banking-chile --bank falabella --movements | jq .

# Listar bancos disponibles
npx open-banking-chile --list

# Con screenshots para debugging
npx open-banking-chile --bank falabella --screenshots --pretty
```

**Opciones CLI:**

| Flag                | Descripci??n                                                     |
| ------------------- | --------------------------------------------------------------- |
| `--bank <id>`       | Banco a consultar (requerido)                                   |
| `--list`            | Listar bancos disponibles                                       |
| `--pretty`          | JSON formateado                                                 |
| `--movements`       | Solo array de movimientos                                       |
| `--screenshots`     | Guardar screenshots en `./screenshots/` y HTML de debug en `./debug/` |
| `--headful`         | Chrome visible (debugging). **BancoEstado e Ita?? siempre usan headful** |
| `--owner <T\|A\|B>` | Filtro Titular/Adicional para TC (default: B = todos)           |

### Como librer??a

```typescript
import { banks, getBank } from "open-banking-chile";

// Opci??n 1: por ID
const falabella = getBank("falabella");
const result = await falabella!.scrape({
  rut: "12345678-9",
  password: "mi_clave",
});

// Opci??n 2: import directo
import { falabella } from "open-banking-chile";
const result = await falabella.scrape({
  rut: "12345678-9",
  password: "mi_clave",
});

if (result.success) {
  console.log(`Banco: ${result.bank}`);

  // Cuenta corriente
  for (const account of result.accounts ?? []) {
    console.log(`Saldo: $${account.balance?.toLocaleString("es-CL")}`);
    for (const m of account.movements) {
      const sign = m.amount > 0 ? "+" : "";
      console.log(`${m.date} | ${m.description.padEnd(40)} | ${sign}$${m.amount.toLocaleString("es-CL")}`);
    }
  }

  // Tarjetas de cr??dito
  for (const card of result.creditCards ?? []) {
    console.log(`\nTarjeta: ${card.label}`);
    for (const m of card.movements ?? []) {
      const sign = m.amount > 0 ? "+" : "";
      console.log(`${m.date} | ${m.description.padEnd(40)} | ${sign}$${m.amount.toLocaleString("es-CL")} [${m.source}]`);
    }
  }
}
```

### Output

```json
{
  "success": true,
  "bank": "falabella",
  "accounts": [
    {
      "balance": 1250000,
      "movements": [
        {
          "date": "08-03-2026",
          "description": "COMPRA SUPERMERCADO LIDER",
          "amount": -45230,
          "balance": 1250000,
          "source": "account"
        }
      ]
    }
  ],
  "creditCards": [
    {
      "label": "CMR Mastercard ****1234",
      "national": { "used": 50000, "available": 950000, "total": 1000000 },
      "nextBillingDate": "19-04-2026",
      "nextDueDate": "05-05-2026",
      "periodExpenses": 15990,
      "movements": [
        {
          "date": "07-03-2026",
          "description": "COMPRA COMERCIO",
          "amount": -15990,
          "balance": 0,
          "source": "credit_card_unbilled",
          "card": "****1234",
          "owner": "titular",
          "installments": "01/03",
          "totalAmount": 47970
        },
        {
          "date": "01-03-2026",
          "description": "PAGO TARJETA DE CR??DITO",
          "amount": 70000,
          "balance": 0,
          "source": "credit_card_billed",
          "card": "****1234"
        }
      ]
    }
  ]
}
```

### Campo `source`

Cada movimiento incluye un campo `source` que indica su origen:

| Valor                  | Descripci??n                       |
| ---------------------- | --------------------------------- |
| `account`              | Cuenta corriente o vista          |
| `credit_card_unbilled` | Tarjeta de cr??dito ??? por facturar |
| `credit_card_billed`   | Tarjeta de cr??dito ??? facturado    |

Campos opcionales en `BankMovement`:

| Campo          | Descripci??n                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `owner`        | `"titular"` o `"adicional"` (Falabella CMR)                                 |
| `card`         | M??scara de la tarjeta, ej: `"****8335"` (BChile, Falabella)                 |
| `installments` | Cuotas en formato `NN/NN`, ej: `"02/06"` = cuota 2 de 6                     |
| `totalAmount`  | Monto total de la compra cuando es en cuotas (Falabella, Ita??)              |
| `currency`     | `"USD"` para movimientos de la secci??n internacional (Ita??); ausente = CLP  |

## Seguridad

- **Tus credenciales nunca salen de tu m??quina**. Todo corre 100% local.
- No hay analytics, telemetr??a, ni tracking.
- Las credenciales se pasan por env vars, nunca se guardan en disco.
- Los screenshots de debug pueden contener datos sensibles ??? no los compartas.
- Lee [SECURITY.md](SECURITY.md) para m??s detalles.

## Arquitectura

El proyecto sigue una **arquitectura limpia en tres capas**, separando responsabilidades para facilitar la reutilizaci??n y la adici??n de nuevos bancos:

```
src/
  index.ts                    ??? Registro de bancos, getBank(), listBanks()
  types.ts                    ??? Interfaces: BankScraper, BankMovement, ScrapeResult
  utils.ts                    ??? Utilidades compartidas (parsing, fechas, dedup)
  cli.ts                      ??? CLI entry point
  infrastructure/
    browser.ts                ??? Gesti??n centralizada del browser (launch, sesi??n, cleanup)
    scraper-runner.ts         ??? Pipeline de ejecuci??n (credenciales ??? browser ??? scrape ??? logout ??? resultado)
  actions/
    login.ts                  ??? Login gen??rico (RUT, password, submit, detecci??n de errores)
    navigation.ts             ??? Navegaci??n DOM (click por texto, sidebars, banners)
    extraction.ts             ??? Extracci??n de movimientos desde tablas HTML
    pagination.ts             ??? Iteraci??n multi-p??gina (texto o selector, espera AJAX)
    credit-card.ts            ??? Extracci??n de movimientos de tarjeta de cr??dito
    balance.ts                ??? Extracci??n de saldo
    two-factor.ts             ??? Detecci??n y espera de 2FA
  banks/
    falabella.ts              ??? Banco Falabella + CMR (cuenta + tarjeta de cr??dito)
    bestado.ts                ??? Banco Estado (CuentaRUT, requiere headful)
    bchile.ts                 ??? Banco de Chile
    bci.ts                    ??? BCI (iframes + BCI Pass)
    bice.ts                   ??? Banco BICE
    cencosud.ts               ??? Tarjeta Cencosud (hCaptcha intermitente, requiere --headful si aparece)
    edwards.ts                ??? Banco Edwards
    itau.ts                   ??? Ita?? (requiere headful: Imperva bloquea headless)
    santander.ts              ??? Banco Santander
    scotiabank.ts             ??? Scotiabank Chile
```

### Capas

**Infrastructure** ??? Gesti??n del ciclo de vida del browser. `launchBrowser()` centraliza la configuraci??n de Chrome (anti-detecci??n, user agent, modo headful/headless). `runScraper()` envuelve toda la ejecuci??n: valida credenciales, abre el browser, ejecuta el scraper del banco, hace logout y cierra el browser. Los errores se capturan y retornan como `ScrapeResult`.

**Actions** ??? Operaciones reutilizables e independientes del banco. Cada banco compone estas acciones en vez de reimplementarlas. Por ejemplo, `fillRut()` soporta m??ltiples formatos de RUT y funciona tanto en `Page` como en iframes; `paginateAndExtract()` navega autom??ticamente por p??ginas acumulando movimientos; `detect2FA()` detecta segundo factor por keywords configurables.

**Banks** ??? Orquestaci??n espec??fica de cada banco. Solo contienen la l??gica particular: selectores CSS propios, flujo de navegaci??n, y configuraci??n de 2FA. Usan `runScraper()` como wrapper y componen acciones del layer anterior.

### Utilidades compartidas (`utils.ts`)

Funciones comunes usadas por scrapers y acciones:

| Funci??n                                         | Descripci??n                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `parseChileanAmount(text)`                      | Parsea montos en formato chileno ($1.234.567) a n??mero                 |
| `parseUsdAmount(text)`                          | Parsea montos en d??lares con decimales ("USD 1.234,56" ??? 1234.56)      |
| `normalizeDate(raw)`                            | Normaliza fechas a DD-MM-YYYY (soporta dd/mm/yyyy, "9 mar 2026", etc.) |
| `normalizeOwner(raw)`                           | Normaliza owner a `"titular"` o `"adicional"`                          |
| `normalizeInstallments(raw)`                    | Normaliza cuotas a formato NN/NN (ej: "1/3" ??? "01/03")                 |
| `deduplicateMovements(movements)`               | Elimina movimientos duplicados por fecha+descripci??n+monto+source      |
| `logout(page, debugLog)`                        | Cierra sesi??n buscando botones comunes (cerrar sesi??n, salir, etc.)    |
| `formatRut(rut)`                                | Formatea RUT (12345678-9 ??? 12.345.678-9)                               |
| `findChrome()`                                  | Busca Chrome/Chromium en el sistema                                    |
| `closePopups(page)`                             | Cierra popups y modales gen??ricos                                      |
| `delay(ms)`                                     | Espera N milisegundos                                                  |
| `saveScreenshot(page, name, enabled, debugLog)` | Guarda screenshot si est?? habilitado                                   |
| `saveHtml(page, name, enabled, debugLog)`       | Guarda el HTML de la p??gina en `debug/` si est?? habilitado             |

## Contribuir

Queremos cubrir **todos los bancos de Chile**. Si tienes cuenta en un banco que falta:

1. Lee [CONTRIBUTING.md](CONTRIBUTING.md) para la gu??a paso a paso
2. Crea `src/banks/<tu-banco>.ts` implementando `BankScraper`
3. Usa `runScraper()` de `infrastructure/` y compone acciones de `actions/` (login, extracci??n, paginaci??n, etc.)
4. Usa las utilidades compartidas de `utils.ts` (parsing, fechas, dedup, logout)
5. Reg??stralo en `src/index.ts`
6. Abre un PR

```typescript
// La interfaz es simple:
interface BankScraper {
  id: string; // "mi-banco"
  name: string; // "Mi Banco Chile"
  url: string; // "https://www.mibanco.cl"
  scrape(options: ScraperOptions): Promise<ScrapeResult>;
}
```

## Automatizaci??n (cron)

```bash
# Ejemplo: sincronizar Falabella diariamente a las 7 AM
0 7 * * * source /home/user/.env && node /path/to/dist/cli.js --bank falabella >> /var/log/bank-sync.log 2>&1

# Ejemplo: sincronizar BICE diariamente y con 3 meses hist??ricos
0 7 * * * source /home/user/.env && BICE_MONTHS=3 node /path/to/dist/cli.js --bank bice >> /var/log/bank-sync.log 2>&1
```

## Troubleshooting

| Problema              | Soluci??n                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Chrome no encontrado  | Instala Chrome o usa `CHROME_PATH=/ruta/chrome`                                                |
| 2FA / Clave din??mica  | Si aparece, apru??balo manualmente en tu banco y vuelve a intentar                              |
| 0 movimientos         | Usa `--screenshots --pretty` y revisa el debug log                                             |
| Login falla           | Verifica RUT y clave, prueba con `--headful`                                                   |
| BancoEstado bloqueado | BancoEstado bloquea headless (TLS fingerprinting). Siempre abre Chrome visible. Ver nota abajo |
| Ita?? bloqueado        | Imperva sirve "Access Denied" a headless y a User-Agents falsos. Corre en headful (Xvfb en servidores). Ver nota abajo |
| Cencosud pide CAPTCHA | Ocurre ocasionalmente. En headless retorna error ??? reintenta con `--headful` para resolverlo manualmente |

### Ita?? e Imperva

Ita?? corre detr??s de Imperva (reese84). El login sigue usando `#loginNameID` / `#pswdId`, pero Imperva responde con un challenge o con "Access Denied" cuando detecta automatizaci??n. Dos cosas gatillan el bloqueo, ambas ya resueltas en `itau.ts`:

- **headless**: cualquier sesi??n headless queda bloqueada (probado con `puppeteer-core` y `rebrowser-puppeteer-core`). El scraper fuerza headful; en Linux requiere Xvfb (`DISPLAY=:99`).
- **User-Agent falso**: `DEFAULT_UA` est?? fijo en `Chrome/131` y no calza con el Chrome instalado, lo que delata la automatizaci??n. Ita?? usa `skipUserAgentOverride` para conservar el UA real.

### Ita??: movimientos de tarjeta de cr??dito

- **No facturados** (`credit_card_unbilled`): se extraen de la p??gina de deuda con la paginaci??n completa (widget Dojo). Las compras en cuotas traen `installments` tal como las muestra el banco (ej. `"00/12"`).
- **Facturados** (`credit_card_billed`): el `amount` es el **valor cuota** (lo que se carga al per??odo), no el monto original de la compra. Para compras en cuotas, `totalAmount` lleva el monto total de la operaci??n ("Monto total a pagar").
- **Internacional** (USD): sus movimientos ???facturados (estado de cuenta internacional) y no facturados??? se reportan con `currency: "USD"` y montos en d??lares; el cupo queda en `creditCards[].international`.

### BancoEstado y modo headless

BancoEstado detecta navegadores headless a nivel de red (TLS fingerprinting), no solo por JavaScript. Ni `puppeteer-extra-plugin-stealth` ni `rebrowser-puppeteer-core` logran evadir esta detecci??n. El scraper siempre corre en modo headful (Chrome visible).

### Tarjeta Cencosud y CAPTCHA

Tarjeta Cencosud presenta ocasionalmente un hCaptcha en el login. No siempre aparece.

- **Headless** (modo por defecto): el scraper detecta el CAPTCHA y retorna un error claro.
- **Headful** (`--headful`): el scraper pausa y espera a que resuelvas el CAPTCHA manualmente en el navegador visible, luego contin??a.

```bash
node dist/cli.js --bank cencosud --headful --pretty
```

El tiempo m??ximo de espera es 180 segundos (configurable con `CENCOSUD_CAPTCHA_TIMEOUT=segundos`).

**En servidores Linux sin GUI**, usa Xvfb (display virtual):

```bash
# Instalar
sudo apt install xvfb

# Correr con display virtual
xvfb-run node dist/cli.js --bank bestado --pretty

# O como parte de tu app
xvfb-run node tu-app.js
```

**En Docker:**

```dockerfile
RUN apt-get update && apt-get install -y xvfb google-chrome-stable
CMD ["xvfb-run", "node", "server.js"]
```

**En Mac/Windows** no necesitas nada extra ??? Chrome se abre y cierra autom??ticamente.

## License

MIT ??? Hecho en Chile ????????
