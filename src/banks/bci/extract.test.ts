import { describe, it, expect } from "vitest";
import { pageFromHtml, readFixture } from "../../testing/dom.js";
import { extractBalance, extractCupo } from "./extract.js";

const balanceHtml = readFixture("./__fixtures__/account-balance.html", import.meta.url);
const balanceFallbackHtml = readFixture(
  "./__fixtures__/account-balance-fallback.html",
  import.meta.url
);
const cupoHtml = readFixture("./__fixtures__/tc-cupo.html", import.meta.url);

describe("extractBalance (iframe de movimientos)", () => {
  it("lee el saldo del bloque #saldoDis + div", async () => {
    expect(await extractBalance(pageFromHtml(balanceHtml))).toBe(1234567);
  });

  it("usa .bci-h2-w800 cuando no hay bloque #saldoDis", async () => {
    expect(await extractBalance(pageFromHtml(balanceFallbackHtml))).toBe(500000);
  });

  it("devuelve undefined cuando el iframe no trae saldo", async () => {
    expect(await extractBalance(pageFromHtml("<p>Sin datos</p>"))).toBeUndefined();
  });
});

describe("extractCupo (iframe de cupo disponible)", () => {
  it("lee el cupo nacional en pesos y el internacional en USD", async () => {
    expect(await extractCupo(pageFromHtml(cupoHtml))).toEqual({
      nationalUsed: 100000,
      nationalAvailable: 900000,
      nationalTotal: 1000000,
      internationalUsed: 10,
      internationalAvailable: 90,
      internationalTotal: 100,
    });
  });

  it("conserva los decimales del cupo internacional en USD", async () => {
    const html = `<div>Utilizado Internacional USD $ 10,50
      Disponible Internacional USD $ 1.234,56 Total Internacional USD $ 1.245,06</div>`;
    expect(await extractCupo(pageFromHtml(html))).toMatchObject({
      internationalUsed: 10.5,
      internationalAvailable: 1234.56,
      internationalTotal: 1245.06,
    });
  });

  it("devuelve ceros cuando el iframe no trae datos de cupo", async () => {
    expect(await extractCupo(pageFromHtml("<p>Sin datos</p>"))).toEqual({
      nationalUsed: 0,
      nationalAvailable: 0,
      nationalTotal: 0,
      internationalUsed: 0,
      internationalAvailable: 0,
      internationalTotal: 0,
    });
  });
});
