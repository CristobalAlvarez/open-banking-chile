import { readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { banks, getBank, listBanks } from "./registry.js";

const bankDirs = readdirSync(new URL("./banks/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("registro de bancos", () => {
  it("registra exactamente un banco por cada directorio de src/banks/", () => {
    expect(Object.keys(banks).sort()).toEqual(bankDirs);
  });

  it("el id de cada banco es el nombre de su directorio", () => {
    for (const dir of bankDirs) expect(getBank(dir)?.id).toBe(dir);
  });

  it("cada banco declara nombre, URL https y un scrape ejecutable", () => {
    for (const bank of Object.values(banks)) {
      expect(bank.name.trim()).not.toBe("");
      expect(bank.url).toMatch(/^https:\/\//);
      expect(typeof bank.scrape).toBe("function");
    }
  });

  it("listBanks() expone id, nombre y URL sin el scraper", () => {
    expect(
      listBanks()
        .map((b) => b.id)
        .sort()
    ).toEqual(bankDirs);
    expect(Object.keys(listBanks()[0]).sort()).toEqual(["id", "name", "url"]);
  });

  it("getBank devuelve undefined para un id desconocido", () => {
    expect(getBank("no-existe")).toBeUndefined();
  });
});
