import bancosecurity from "./banks/bancosecurity/index.js";
import bchile from "./banks/bchile/index.js";
import bci from "./banks/bci/index.js";
import bestado from "./banks/bestado/index.js";
import bice from "./banks/bice/index.js";
import cencosud from "./banks/cencosud/index.js";
import edwards from "./banks/edwards/index.js";
import falabella from "./banks/falabella/index.js";
import itau from "./banks/itau/index.js";
import santander from "./banks/santander/index.js";
import scotiabank from "./banks/scotiabank/index.js";
import type { BankScraper } from "./core/types.js";

/**
 * Todos los bancos soportados. Agregar un banco es una línea aquí (más su import):
 * `banks`, `getBank` y `listBanks` se derivan de esta lista, y `registry.test.ts` verifica que
 * cada directorio de `src/banks/` esté registrado.
 */
const all: readonly BankScraper[] = [
  bancosecurity,
  bchile,
  bci,
  bestado,
  bice,
  cencosud,
  edwards,
  falabella,
  itau,
  santander,
  scotiabank,
];

/** Registro de todos los bancos disponibles, por ID. */
export const banks: Readonly<Record<string, BankScraper>> = Object.fromEntries(
  all.map((bank) => [bank.id, bank])
);

/** Lista de bancos soportados. */
export function listBanks(): Array<{ id: string; name: string; url: string }> {
  return all.map(({ id, name, url }) => ({ id, name, url }));
}

/** Obtener un scraper por ID. */
export function getBank(id: string): BankScraper | undefined {
  return banks[id];
}
