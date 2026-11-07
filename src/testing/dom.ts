import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import type { Page } from "puppeteer-core";

/** Globales del navegador que el código de `page.evaluate` puede tocar. */
const BROWSER_GLOBALS = [
  "document",
  "window",
  "Node",
  "Element",
  "HTMLElement",
  "Document",
  "ShadowRoot",
  "Event",
] as const;

/**
 * Una "página" para tests: ejecuta los callbacks de `page.evaluate` contra un DOM real (happy-dom)
 * cargado con `html`, así la extracción de cada banco se prueba offline con fixtures HTML.
 *
 * Solo cubre lo que el scraper lee del DOM (`evaluate`); no navega ni hace clic de verdad.
 */
export function pageFromHtml(html: string): Page {
  const window = new Window();
  window.document.body.innerHTML = html;
  const dom = window as unknown as Record<string, unknown>;
  const globals = globalThis as unknown as Record<string, unknown>;

  const evaluate = async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
    const previous = BROWSER_GLOBALS.map((name) => [name, globals[name]] as const);
    for (const name of BROWSER_GLOBALS) {
      globals[name] = name === "window" ? window : dom[name];
    }
    try {
      return fn(...args);
    } finally {
      for (const [name, value] of previous) globals[name] = value;
    }
  };
  return { evaluate } as unknown as Page;
}

/** Lee un fixture HTML (ruta relativa al archivo de test que lo pide, vía `import.meta.url`). */
export function readFixture(relativePath: string, from: string): string {
  return readFileSync(new URL(relativePath, from), "utf8");
}
