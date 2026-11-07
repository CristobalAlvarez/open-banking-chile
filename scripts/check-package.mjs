// Verifica el paquete tal como lo recibe un consumidor (bort): construye, empaqueta, instala el
// tarball en un proyecto vacío y comprueba que ESM y CJS exponen la API pública.
//
//   npm run check:package
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "obc-package-"));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

try {
  run("npm", ["run", "build"], root);
  const tarball = join(
    tmp,
    run("npm", ["pack", "--pack-destination", tmp, "--silent"], root).trim()
  );

  const files = run("tar", ["-tzf", tarball], root).split("\n").filter(Boolean);
  const unexpected = files.filter(
    (f) => !/^package\/(dist\/|package\.json$|README\.md$|LICENSE$)/.test(f)
  );
  if (unexpected.length > 0)
    throw new Error(`Archivos inesperados en el paquete:\n${unexpected.join("\n")}`);

  writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  run("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], tmp);

  const probe = `
    const mod = process.argv[2] === "esm" ? await import("open-banking-chile") : require("open-banking-chile");
    const banks = mod.listBanks();
    if (typeof mod.getBank !== "function" || banks.length === 0) throw new Error("API pública incompleta");
    for (const { id, name, url } of banks) {
      const bank = mod.getBank(id);
      if (!name || !url || typeof bank?.scrape !== "function") throw new Error("Banco inválido: " + id);
    }
    console.log(process.argv[2] + ": " + banks.length + " bancos");
  `;
  writeFileSync(join(tmp, "probe.mjs"), probe);
  writeFileSync(
    join(tmp, "probe.cjs"),
    `(async () => {${probe}})().catch((e) => { console.error(e); process.exit(1); });`
  );
  process.stdout.write(run("node", ["probe.mjs", "esm"], tmp));
  process.stdout.write(run("node", ["probe.cjs", "cjs"], tmp));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
