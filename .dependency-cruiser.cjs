/**
 * Fronteras de import por capas (cada capa solo conoce las de más abajo):
 *
 *   banks → steps → browser → core
 *
 * - core:    tipos y lógica pura (parseo, fechas, deduplicación). Sin navegador ni E/S.
 * - browser: ciclo de vida de Chrome (launch, runner, intercept, artefactos de depuración).
 * - steps:   pasos reutilizables sobre una página (login, paginación, 2FA…).
 * - banks:   un scraper por banco; usa las tres capas y no conoce a otros bancos.
 *
 * `src/index.ts` (API pública) y `src/testing/` (ayudas de tests) quedan fuera de las capas.
 * Se ejecuta con `npm run depcruise` (también dentro de `npm run check` y en CI).
 */
const TESTS = "\\.test\\.ts$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Sin dependencias circulares.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Archivo huérfano: nadie lo importa (¿código muerto?).",
      severity: "error",
      from: { orphan: true, path: "^src", pathNot: [TESTS, "\\.d\\.ts$"] },
      to: {},
    },
    {
      name: "core-does-not-depend-on-upper-layers",
      comment:
        "core es la base: no importa browser, steps ni banks, ni ningún driver de navegador (ni siquiera como tipo).",
      severity: "error",
      from: { path: "^src/core/", pathNot: TESTS },
      to: {
        path: ["^src/(browser|steps|banks)/", "^node_modules/(puppeteer-core|playwright-core)"],
      },
    },
    {
      name: "core-has-no-io",
      comment: "core es puro: sin módulos de Node (fs, path, os…). La E/S vive en browser/.",
      severity: "error",
      from: { path: "^src/core/", pathNot: TESTS },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "browser-only-depends-on-core",
      comment: "browser no conoce steps ni banks.",
      severity: "error",
      from: { path: "^src/browser/", pathNot: TESTS },
      to: { path: "^src/(steps|banks)/" },
    },
    {
      name: "steps-do-not-depend-on-banks",
      comment: "steps son genéricos: usan core y browser, nunca un banco concreto.",
      severity: "error",
      from: { path: "^src/steps/", pathNot: TESTS },
      to: { path: "^src/banks/" },
    },
    {
      name: "banks-are-isolated",
      comment:
        "Un banco no importa a otro banco: lo que comparten vive en core/, browser/ o steps/.",
      severity: "error",
      from: { path: "^src/banks/([^/.]+)", pathNot: TESTS },
      to: { path: "^src/banks/(?!$1[./])", pathNot: TESTS },
    },
    {
      name: "browser-driver-only-in-browser",
      comment:
        "puppeteer/playwright solo se importan como valor desde browser/. El resto recibe la BrowserSession (usa `import type` para los tipos).",
      severity: "error",
      from: { path: "^src", pathNot: ["^src/browser/", TESTS] },
      to: {
        path: "^node_modules/(puppeteer-core|playwright-core)",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "testing-helpers-only-from-tests",
      comment: "src/testing/ son ayudas de tests: el código publicado no las importa.",
      severity: "error",
      from: { path: "^src", pathNot: [TESTS, "^src/testing/"] },
      to: { path: "^src/testing/" },
    },
    {
      name: "no-dev-only-deps-in-src",
      comment: "El código publicado no importa dependencias de desarrollo.",
      severity: "error",
      from: { path: "^src", pathNot: [TESTS, "^src/testing/"] },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["^node_modules/@types/"],
      },
    },
  ],
  required: [
    {
      name: "banks-use-scraper-runner",
      comment:
        "Todo banco pasa por runScraper() (ciclo de vida común del navegador). Única excepción: falabella, escrito sobre Playwright (browser/playwright.ts); portarlo exige validarlo contra el banco real.",
      severity: "error",
      module: {
        path: "^src/banks/[^/]+(\\.ts|/index\\.ts)$",
        pathNot: [TESTS, "^src/banks/falabella/"],
      },
      to: { path: "^src/browser/scraper-runner\\.ts$" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^dist/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
