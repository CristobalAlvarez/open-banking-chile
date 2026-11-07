import { expect } from "vitest";
import { CARD_OWNER, MOVEMENT_SOURCE } from "../core/types.js";
import type { BankMovement } from "../core/types.js";

const SOURCES: readonly string[] = Object.values(MOVEMENT_SOURCE);
const OWNERS: readonly string[] = Object.values(CARD_OWNER);

/**
 * Lista las violaciones del contrato de `BankMovement` (src/types.ts) que ve el consumidor:
 * fecha `dd-mm-yyyy`, montos numéricos, origen y titular dentro de sus enumeraciones, cuotas `NN/NN`.
 * Devuelve `[]` si el movimiento es válido.
 */
export function movementContractViolations(movement: BankMovement): string[] {
  const m: Record<string, unknown> = { ...movement };
  const problems: string[] = [];
  const fail = (message: string) => problems.push(`${message} (${JSON.stringify(m)})`);

  if (typeof m.date !== "string" || !/^\d{2}-\d{2}-\d{4}$/.test(m.date))
    fail("date no es dd-mm-yyyy");
  if (typeof m.description !== "string" || m.description.trim() === "") fail("description vacía");
  if (typeof m.amount !== "number" || !Number.isFinite(m.amount) || m.amount === 0) {
    fail("amount no es un número distinto de 0");
  }
  if (typeof m.balance !== "number" || !Number.isFinite(m.balance)) fail("balance no es un número");
  if (typeof m.source !== "string" || !SOURCES.includes(m.source))
    fail("source fuera de MOVEMENT_SOURCE");
  if (m.owner !== undefined && (typeof m.owner !== "string" || !OWNERS.includes(m.owner))) {
    fail("owner fuera de CARD_OWNER");
  }
  if (
    m.installments !== undefined &&
    (typeof m.installments !== "string" || !/^\d{2}\/\d{2}$/.test(m.installments))
  ) {
    fail("installments no es NN/NN");
  }
  if (m.totalAmount !== undefined && !Number.isFinite(m.totalAmount))
    fail("totalAmount no es numérico");
  if (m.currency !== undefined && m.currency !== "CLP" && m.currency !== "USD")
    fail("currency inválida");

  return problems;
}

/** Aserción de test: hay movimientos y todos cumplen el contrato de `BankMovement`. */
export function expectMovementContract(movements: BankMovement[]): void {
  expect(movements.length).toBeGreaterThan(0);
  expect(movements.flatMap(movementContractViolations)).toEqual([]);
}
