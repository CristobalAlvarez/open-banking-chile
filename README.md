# Open Banking Chile

Scrapers open source para bancos chilenos. Obtén tus movimientos bancarios y saldo como JSON limpio.

> **Disclaimer**: Este proyecto no está afiliado con ningún banco. Úsalo bajo tu propia responsabilidad y solo con tus propias credenciales.

## Migración v2 → v3

**v3.0.0 introduce un cambio breaking en `ScrapeResult`**: los movimientos ya no están en un array plano `result.movements`; viven dentro de cada cuenta o tarjeta. Los campos `movements` y `balance` de la raíz se eliminaron.

| Antes (v2)         | Ahora (v3)                        |
| ------------------ | --------------------------------- |
| `result.movements` | `result.accounts[i].movements`    |
| `result.balance`   | `result.accounts[i].balance`      |
| _(no existía)_     | `result.creditCards[i].movements` |

```ts
// v2 (ya no es válido)
console.log(result.balance);
for (const m of result.movements) { ... }

// v3
const cuenta = result.accounts?.[0];
console.log(cuenta?.balance);
for (const m of cuenta?.movements ?? []) { ... }
```

Además, la librería **ya no trae CLI** y **no lee variables de entorno**: toda la configuración entra por `scrape(options)` (ver [Opciones](#opciones-de-scrape)). Para probar un banco durante el desarrollo existe `npm run smoke` (ver [Probar un banco desde el repo](#probar-un-banco-desde-el-repo)).

## Bancos soportados

| Banco                             | ID              | Estado                   |
| --------------------------------- | --------------- | ------------------------ |
| Banco Falabella (cuenta + CMR TC) | `falabella`     | ✅ Funcional             |
| Banco BICE                        | `bice`          | ✅ Funcional             |
| Banco Santander                   | `santander`     | ✅ Funcional             |
| Banco Edwards                     | `edwards`       | ✅ Funcional             |
| Scotiabank                        | `scotiabank`    | ✅ Funcional             |
| Banco de Chile                    | `bchile`        | ✅ Funcional             |
| BCI                               | `bci`           | ✅ Funcional             |
| Itaú                              | `itau`          | ✅ Funcional             |
| Banco Estado (CuentaRUT)          | `bestado`       | ✅ Funcional             |
| Tarjeta Cencosud                  | `cencosud`      | ✅ Funcional             |
| Banco Security                    | `bancosecurity` | 🟡 Solo cuenta corriente |

**¿Tu banco no está?** → [Contribuir](#contribuir)

## Requisitos

- **Node.js** >= 20
- **Google Chrome** o **Chromium** (la librería no lo descarga: lo busca en el sistema o usa `chromePath`)

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y google-chrome-stable

# macOS
brew install --cask google-chrome
```

## Instalación

El paquete no se publica en npm ni se construye al instalar: clónalo, instala y construye `dist/`.

```bash
git clone https://github.com/kaihv/open-banking-chile.git
cd open-banking-chile
npm ci
npm run build
```

Para usarlo desde otro proyecto, apúntalo al directorio ya construido (`"open-banking-chile": "file:../open-banking-chile"` en el `package.json` de tu app). `npm install github:…` no sirve: `dist/` no está versionado y el paquete ya no lo construye durante la instalación.

## Uso

### Como librería

```ts
import { getBank } from "open-banking-chile";

const result = await getBank("falabella")!.scrape({
  rut: "12345678-9",
  password: "mi_clave",
});

if (result.success) {
  for (const account of result.accounts ?? []) {
    console.log(
      `${account.label ?? "Cuenta"} — saldo: $${account.balance?.toLocaleString("es-CL")}`
    );
    for (const m of account.movements) {
      console.log(`${m.date} | ${m.description.padEnd(40)} | $${m.amount.toLocaleString("es-CL")}`);
    }
  }

  for (const card of result.creditCards ?? []) {
    console.log(`Tarjeta: ${card.label}`);
    for (const m of card.movements ?? []) {
      console.log(
        `${m.date} | ${m.description.padEnd(40)} | $${m.amount.toLocaleString("es-CL")} [${m.source}]`
      );
    }
  }
} else {
  console.error(result.error, result.debug);
}
```

Los bancos disponibles se listan con `listBanks()`. Desde la v3 no hay exports nombrados por banco (`import { falabella } ...`): se obtienen siempre con `getBank(id)`.

### Opciones de `scrape()`

| Opción                | Descripción                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `rut`, `password`     | Credenciales (requeridas)                                                                         |
| `headful`             | Chrome visible. **BancoEstado e Itaú siempre usan headful**                                       |
| `proxyUrl`            | Proxy SOCKS5/HTTP para el navegador                                                               |
| `chromePath`          | Ruta a Chrome/Chromium (si no, se busca en el sistema)                                            |
| `since`               | Fecha `dd-mm-yyyy` hasta la que se necesitan movimientos (corta la paginación)                    |
| `owner`               | Filtro Titular/Adicional para TC en Falabella: `"T"`, `"A"` o `"B"` (default: todos)              |
| `historicalMonths`    | Periodos históricos extra (BICE, Banco Security, Scotiabank). Cada banco aplica su default y tope |
| `twoFactorTimeoutSec` | Espera máxima de la aprobación manual del 2FA (BChile, BCI, Santander, Itaú). Default: 180        |
| `captchaTimeoutSec`   | Espera máxima para resolver el CAPTCHA en headful (Cencosud). Default: 180                        |
| `saveScreenshots`     | Guarda capturas en `./screenshots/` y HTML en `./debug/` (contienen datos personales)             |
| `onProgress`          | Callback con el paso actual                                                                       |
| `onDebug`             | Callback con cada línea del log de depuración                                                     |

### Resultado

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
        }
      ]
    }
  ]
}
```

Garantías del contrato (se verifican con tests): `date` siempre `dd-mm-yyyy`, `amount` es un número (positivo = abono, negativo = cargo) y `source` es uno de estos:

| Valor                  | Descripción                      |
| ---------------------- | -------------------------------- |
| `account`              | Cuenta corriente o vista         |
| `credit_card_unbilled` | Tarjeta de crédito, por facturar |
| `credit_card_billed`   | Tarjeta de crédito, facturado    |

Campos opcionales de `BankMovement`:

| Campo          | Descripción                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `owner`        | `"titular"` o `"adicional"` (Falabella CMR)                                |
| `card`         | Máscara de la tarjeta, ej: `"****8335"` (BChile, Falabella)                |
| `installments` | Cuotas en formato `NN/NN`, ej: `"02/06"` = cuota 2 de 6                    |
| `totalAmount`  | Monto total de la compra cuando es en cuotas (Falabella, Itaú)             |
| `currency`     | `"USD"` para movimientos de la sección internacional (Itaú); ausente = CLP |

### Probar un banco desde el repo

Copia `.env.example` a `.env`, completa `<BANCO>_RUT` y `<BANCO>_PASS` y ejecuta:

```bash
npm run build
npm run smoke -- falabella --screenshots
npm run smoke -- bice --months=3
```

`smoke` es solo una herramienta de desarrollo: vuelca el resultado como JSON. Flags: `--headful`, `--screenshots`, `--months=N`, `--since=dd-mm-yyyy`, `--owner=T|A|B`.

### Automatización

La librería no trae CLI: programa tu propio script (cron, systemd, etc.) que llame a `scrape()` y guarde el resultado.

```js
// sync.mjs
import { getBank } from "open-banking-chile";

const result = await getBank("falabella").scrape({
  rut: process.env.FALABELLA_RUT,
  password: process.env.FALABELLA_PASS,
});
console.log(JSON.stringify(result));
```

```bash
# Sincronizar Falabella diariamente a las 7 AM
0 7 * * * node --env-file=/home/user/.env /path/to/sync.mjs >> /var/log/bank-sync.log 2>&1
```

## Seguridad

- **Tus credenciales nunca salen de tu máquina**. Todo corre 100 % local.
- No hay analytics, telemetría ni tracking.
- Las credenciales se pasan como argumento a `scrape()`; la librería no las guarda en disco ni lee el entorno.
- Los screenshots de depuración pueden contener datos sensibles: no los compartas.
- Lee [SECURITY.md](SECURITY.md) para más detalles.

## Arquitectura

Cuatro capas; cada una solo conoce las de más abajo (`npm run depcruise` lo hace cumplir):

```
banks → steps → browser → core
```

```
src/
  index.ts          API pública: getBank(), listBanks(), tipos
  core/             Puro: tipos, parseo (montos, fechas, RUT), deduplicación, DebugLog
  browser/          Ciclo de vida de Chrome: launchBrowser, runScraper, intercept, artefactos
  steps/            Pasos reutilizables sobre una página: login, navegación, extracción,
                    paginación, tarjeta de crédito, saldo, 2FA, popups
  banks/<id>/       Un scraper por banco (index, login, navigation, parse…)
  testing/          Ayudas solo para tests (validador del contrato, páginas desde HTML)
```

- **core**: sin navegador ni E/S. Lo que se puede probar sin Chrome.
- **browser**: `runScraper()` valida credenciales, abre el navegador, ejecuta el scraper del banco, hace logout y cierra. Los errores se capturan y se devuelven como `ScrapeResult`.
- **steps**: operaciones independientes del banco (`fillRut` soporta varios formatos de RUT y funciona en `Page` o iframes; `paginateAndExtract` recorre páginas acumulando movimientos; `detect2FA` detecta un segundo factor).
- **banks**: la lógica particular de cada banco (selectores, flujo de navegación, normalización de su API). Componen las capas inferiores; ninguno importa a otro.

La guía completa para quienes desarrollan (comandos, convenciones, cómo se verifica todo) está en [AGENTS.md](AGENTS.md).

## Contribuir

Queremos cubrir **todos los bancos de Chile**. Si tienes cuenta en un banco que falta:

1. Lee [CONTRIBUTING.md](CONTRIBUTING.md): guía paso a paso y plantilla (`src/banks/edwards/`).
2. Implementa `BankScraper` usando `runScraper()` y los pasos de `steps/`.
3. Agrega tests (parseo contra fixtures sintéticas, contrato de `BankMovement`).
4. Corre `npm run verify` y abre un PR.

```ts
interface BankScraper {
  id: string; // "mi-banco"
  name: string; // "Mi Banco Chile"
  url: string; // "https://www.mibanco.cl"
  scrape(options: ScraperOptions): Promise<ScrapeResult>;
}
```

## Troubleshooting

| Problema              | Solución                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chrome no encontrado  | Instala Chrome o pasa `chromePath: "/ruta/chrome"` (con `smoke`: `CHROME_PATH=/ruta/chrome`)                           |
| 2FA / Clave dinámica  | Si aparece, apruébalo manualmente en tu banco; el scraper espera hasta `twoFactorTimeoutSec`                           |
| 0 movimientos         | Activa `saveScreenshots` (con `smoke`: `--screenshots`) y revisa el log de depuración (`result.debug`)                 |
| Login falla           | Verifica RUT y clave, prueba con `headful: true`                                                                       |
| BancoEstado bloqueado | BancoEstado bloquea headless (TLS fingerprinting). Siempre abre Chrome visible. Ver nota abajo                         |
| Itaú bloqueado        | Imperva sirve "Access Denied" a headless y a User-Agents falsos. Corre en headful (Xvfb en servidores). Ver nota abajo |
| Cencosud pide CAPTCHA | Ocurre ocasionalmente. En headless retorna error: reintenta con `headful: true` para resolverlo manualmente            |

### Itaú e Imperva

Itaú corre detrás de Imperva (reese84). El login usa `#loginNameID` / `#pswdId`, pero Imperva responde con un challenge o con "Access Denied" cuando detecta automatización. Dos cosas gatillan el bloqueo, ambas ya resueltas en `src/banks/itau/`:

- **headless**: cualquier sesión headless queda bloqueada (probado con `puppeteer-core` y `rebrowser-puppeteer-core`). El scraper fuerza headful; en Linux requiere Xvfb (`DISPLAY=:99`).
- **User-Agent falso**: el User-Agent por defecto está fijo en `Chrome/131` y no calza con el Chrome instalado, lo que delata la automatización. Itaú usa `skipUserAgentOverride` para conservar el UA real.

### Itaú: movimientos de tarjeta de crédito

- **No facturados** (`credit_card_unbilled`): se extraen de la página de deuda con la paginación completa (widget Dojo). Las compras en cuotas traen `installments` tal como las muestra el banco (`NN/NN`, cuota actual / total); en pagos únicos, comisiones y abonos el banco deja la celda vacía y `installments` queda ausente (no se inventa).
- **Facturados** (`credit_card_billed`): el `amount` es el **valor cuota** (lo que se carga al período), no el monto original de la compra. Para compras en cuotas, `totalAmount` lleva el monto total de la operación ("Monto total a pagar"). `installments` viene en todas las filas; el pago único es `"01/01"`.
- **Internacional** (USD): sus movimientos (facturados del estado de cuenta internacional y no facturados) se reportan con `currency: "USD"` y montos en dólares; el cupo queda en `creditCards[].international`. Esas tablas no tienen columna de cuotas: `installments` queda ausente.

### BancoEstado y modo headless

BancoEstado detecta navegadores headless a nivel de red (TLS fingerprinting), no solo por JavaScript. Ni `puppeteer-extra-plugin-stealth` ni `rebrowser-puppeteer-core` logran evadir esta detección. El scraper siempre corre en modo headful (Chrome visible).

### Tarjeta Cencosud y CAPTCHA

Tarjeta Cencosud presenta ocasionalmente un hCaptcha en el login. No siempre aparece.

- **Headless** (modo por defecto): el scraper detecta el CAPTCHA y retorna un error claro.
- **Headful** (`headful: true`): el scraper pausa y espera a que resuelvas el CAPTCHA manualmente en el navegador visible, luego continúa.

```ts
await getBank("cencosud")!.scrape({ rut, password, headful: true });
```

El tiempo máximo de espera es 180 segundos (configurable con `captchaTimeoutSec`).

### Servidores sin pantalla (headful)

**En servidores Linux sin GUI**, usa Xvfb (display virtual):

```bash
# Instalar
sudo apt install xvfb

# Correr con display virtual
xvfb-run npm run smoke -- bestado

# O como parte de tu app
xvfb-run node tu-app.js
```

**En Docker:**

```dockerfile
RUN apt-get update && apt-get install -y xvfb google-chrome-stable
CMD ["xvfb-run", "node", "server.js"]
```

**En Mac/Windows** no necesitas nada extra: Chrome se abre y cierra automáticamente.

## Licencia

MIT. Hecho en Chile 🇨🇱
