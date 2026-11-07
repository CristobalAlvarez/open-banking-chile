// Ejecuta un scraper real contra el banco y vuelca el resultado como JSON. Solo para desarrollo:
// no se publica ni forma parte de la librería.
//
//   npm run smoke -- <banco> [--headful] [--screenshots] [--months=N] [--since=dd-mm-yyyy] [--owner=T|A|B]
//
// Credenciales: <BANCO>_RUT y <BANCO>_PASS (ej. BCHILE_RUT) en `.env` (ver `.env.example`).
import { getBank, listBanks } from "../dist/index.js";

const [bankId, ...flags] = process.argv.slice(2);
const bank = bankId ? getBank(bankId) : undefined;

if (!bank) {
  const ids = listBanks()
    .map((b) => b.id)
    .join(", ");
  console.error(
    `Uso: npm run smoke -- <banco> [--headful] [--screenshots] [--months=N] [--since=dd-mm-yyyy] [--owner=T|A|B]`
  );
  console.error(`Bancos: ${ids}`);
  process.exit(bankId ? 1 : 0);
}

const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1];
const prefix = bankId.toUpperCase();
const rut = process.env[`${prefix}_RUT`];
const password = process.env[`${prefix}_PASS`];
if (!rut || !password) {
  console.error(`Faltan ${prefix}_RUT y ${prefix}_PASS en .env`);
  process.exit(1);
}

const months = flag("months");
const result = await bank.scrape({
  rut,
  password,
  chromePath: process.env.CHROME_PATH,
  headful: flags.includes("--headful"),
  saveScreenshots: flags.includes("--screenshots"),
  since: flag("since"),
  owner: flag("owner")?.toUpperCase(),
  ...(months !== undefined && { historicalMonths: Number(months) }),
  onProgress: (step) => console.error(`› ${step}`),
});

const output = { ...result, screenshot: undefined };
console.log(JSON.stringify(output, null, 2));
process.exit(result.success ? 0 : 1);
