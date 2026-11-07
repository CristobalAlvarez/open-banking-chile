import { describe, it, expect } from "vitest";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { listMovementAccounts } from "./navigation.js";

const carousel = readFixture("./__fixtures__/movement-accounts.html", import.meta.url);

describe("listMovementAccounts (carrusel de cuentas)", () => {
  it("etiqueta cada cuenta con su tipo y deja el índice del slide", async () => {
    const accounts = await listMovementAccounts(pageFromHtml(carousel));

    // Solo el tipo: el formato del número es una heurística de la UI y no un contrato.
    expect(accounts.map(({ index, label }) => [index, label.split(/\s[\d.#\s]+$/)[0]])).toEqual([
      [0, "Cuenta Corriente"],
      [1, "Cuenta Vista"],
      [3, "Cuenta Vista"],
    ]);
  });

  it("ignora slides sin texto", async () => {
    const accounts = await listMovementAccounts(pageFromHtml(carousel));

    expect(accounts.map((a) => a.index)).toEqual([0, 1, 3]);
  });
});
