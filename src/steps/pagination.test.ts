import { describe, it, expect } from "vitest";
import type { Page } from "puppeteer-core";
import type { BankMovement } from "../core/types.js";
import { domPage } from "../testing/dom.js";
import { paginateAndExtract } from "./pagination.js";

const ITAU_NEXT = '<a name="nextbtn" data-next href="#">›</a>';

/**
 * Un portal paginado como el de Itaú: la tabla muestra una página y el botón siguiente la
 * reemplaza por la que sigue. En la última página el botón sigue ahí y el clic no hace nada.
 * Cada página es la lista de descripciones de sus filas.
 */
function pagedPortal(pages: string[][], nextButton = ITAU_NEXT): Page {
  const render = (index: number) =>
    `<table>${pages[index].map((d) => `<tr><td name="desc">${d}</td></tr>`).join("")}</table>` +
    nextButton;
  const { page: dom, window } = domPage(render(0));
  let current = 0;
  const wire = () => {
    window.document.querySelector("[data-next]")?.addEventListener("click", () => {
      if (current === pages.length - 1) return;
      current++;
      window.document.body.innerHTML = render(current);
      wire();
    });
  };
  wire();

  return {
    evaluate: dom.evaluate,
    // La espera real reintenta hasta el timeout; aquí la condición se evalúa una sola vez.
    waitForFunction: async (
      condition: (...args: unknown[]) => unknown,
      _o: unknown,
      ...a: unknown[]
    ) => {
      if (!(await dom.evaluate(condition, ...a))) throw new Error("timeout");
    },
  } as unknown as Page;
}

async function readRows(page: Page): Promise<BankMovement[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[name="desc"]'), (cell): BankMovement => ({
      date: "01-10-2026",
      description: cell.textContent ?? "",
      amount: -1,
      balance: 0,
      source: "account",
    }))
  );
}

const descriptions = (movements: BankMovement[]) => movements.map((m) => m.description);

const widget = { nextSelector: "[data-next]", waitForRefreshSelector: '[name="desc"]' };

describe("paginateAndExtract", () => {
  it("recorre todas las páginas del widget y devuelve los movimientos en orden", async () => {
    const page = pagedPortal([["a", "b"], ["c", "d"], ["e"]]);

    const movements = await paginateAndExtract(page, readRows, [], widget);

    expect(descriptions(movements)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("no duplica la última página cuando el botón siguiente sigue activo pero ya no hace nada", async () => {
    // Itaú no deshabilita el botón en la última página: el clic no refresca la tabla.
    const page = pagedPortal([["a"], ["b"]]);

    const movements = await paginateAndExtract(page, readRows, [], widget);

    expect(descriptions(movements)).toEqual(["a", "b"]);
  });

  it("avisa de cada página con su número, empezando en 1", async () => {
    const page = pagedPortal([["a"], ["b"], ["c"]]);
    const numbers: number[] = [];

    await paginateAndExtract(page, readRows, [], {
      ...widget,
      onPage: async (_page, pageNumber) => {
        numbers.push(pageNumber);
      },
    });

    expect(numbers).toEqual([1, 2, 3]);
  });

  it("se detiene en maxPages aunque el portal tenga más páginas", async () => {
    const page = pagedPortal([["a"], ["b"], ["c"], ["d"]]);

    const movements = await paginateAndExtract(page, readRows, [], { ...widget, maxPages: 2 });

    expect(descriptions(movements)).toEqual(["a", "b"]);
  });

  it("no hace clic cuando el botón siguiente está deshabilitado", async () => {
    const disabled = '<a name="nextbtn" data-next class="disabled" href="#">›</a>';
    const page = pagedPortal([["a"], ["b"]], disabled);

    const movements = await paginateAndExtract(page, readRows, [], widget);

    expect(descriptions(movements)).toEqual(["a"]);
  });

  it("pagina por el texto del botón cuando el banco no da un selector", async () => {
    const page = pagedPortal([["a"], ["b"]], "<button data-next>Siguiente</button>");

    const movements = await paginateAndExtract(page, readRows, [], { delayMs: 0, maxPages: 2 });

    expect(descriptions(movements)).toEqual(["a", "b"]);
  });
});
