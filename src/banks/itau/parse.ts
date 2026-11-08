import type { BankMovement, CreditCardBalance, MovementSource } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import {
  parseChileanAmount,
  parseUsdAmount,
  normalizeDate,
  normalizeInstallments,
} from "../../core/parsing.js";

export interface ItauCreditCardRow {
  date: string;
  desc: string;
  amount: string;
  isCredit: boolean;
  installments?: string;
}

/**
 * Convierte filas simples de TC a movimientos: no facturados nacionales (CLP)
 * e internacionales (USD), y facturados internacionales (USD).
 *
 * El signo sale del monto (negativo = abono) o de la clase de la celda
 * (`cargos`/`abono`). `currency` solo se agrega cuando no es CLP.
 */
export function normalizeItauCreditCardRows(
  rows: ItauCreditCardRow[],
  opts: { source: MovementSource; currency?: "CLP" | "USD" }
): BankMovement[] {
  const currency = opts.currency ?? "CLP";
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const parsed = currency === "USD" ? parseUsdAmount(m.amount) : parseChileanAmount(m.amount);
    if (parsed === 0) continue;
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount: parsed < 0 || m.isCredit ? Math.abs(parsed) : -Math.abs(parsed),
      balance: 0,
      source: opts.source,
      installments: normalizeInstallments(m.installments),
      ...(currency === "USD" ? { currency: "USD" as const } : {}),
    });
  }
  return movements;
}

export interface ItauBilledRow {
  date: string;
  desc: string;
  total: string;
  cuota: string;
  valorCuota: string;
}

/**
 * Convierte filas crudas del estado de cuenta (cuenta nacional) a movimientos.
 *
 * "Valor cuota" es lo que se carga al período; para compras en cuotas es menor
 * que "Monto Operación", que es el total de la operación. Ese total va en
 * totalAmount ("Monto total a pagar") cuando difiere del cargo del período.
 */
export function normalizeItauBilledRows(rows: ItauBilledRow[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const m of rows) {
    const charged = parseChileanAmount(m.valorCuota);
    if (charged === 0) continue;
    const amount = charged > 0 ? -charged : Math.abs(charged);
    const total = parseChileanAmount(m.total);
    movements.push({
      date: normalizeDate(m.date),
      description: m.desc,
      amount,
      balance: 0,
      source: MOVEMENT_SOURCE.credit_card_billed,
      installments: normalizeInstallments(m.cuota),
      ...(Math.abs(total) !== Math.abs(charged) ? { totalAmount: Math.abs(total) } : {}),
    });
  }
  return movements;
}

// ─── Resumen de la tarjeta (página de deuda) ─────────────────────

const CARD_LABEL = /(Mastercard|Visa)\s+[\w\s]+\*{4}\s*\*{4}\s*\*{4}\s*(\d{4})/i;

/**
 * Lee la tarjeta de la página de deuda a partir de su texto visible: etiqueta
 * (`Mastercard Legend ****1234`), cupo nacional (CLP), cupo internacional (USD) y próxima
 * facturación. Devuelve `undefined` si no hay tarjeta.
 *
 * Cada sección muestra "Cupo disponible <valor>", luego las etiquetas "Cupo utilizado" y
 * "Cupo total", y después sus dos valores: los valores llegan en el mismo orden que las
 * etiquetas. El cupo internacional se lee emparejando etiquetas y valores en orden de
 * aparición, no por posición fija: así disponible, utilizado y total no se cruzan, y el
 * "Monto facturado" que viene después queda fuera. El total nacional es utilizado + disponible.
 */
export function parseCreditCardSummary(text: string): CreditCardBalance | undefined {
  const cardMatch = text.match(CARD_LABEL);
  if (!cardMatch) return undefined;
  const label = cardMatch[0]
    .replace(/\*{4}\s*\*{4}\s*\*{4}\s*/, "****")
    .replace(/\s+/g, " ")
    .trim();

  const nacSection =
    text.match(/Nacional[\s\S]*?(?=Internacional|Ofertas|Movimientos|$)/)?.[0] ?? "";
  const nacAvailable = parseChileanAmount(
    nacSection.match(/Cupo disponible\s*\$\s*([\d.]+)/)?.[1] ?? "0"
  );
  const nacUsed = parseChileanAmount(
    nacSection.match(/Cupo utilizado\s*(?:[\s\S]*?\$\s*([\d.]+))?/)?.[1] ?? "0"
  );
  const card: CreditCardBalance = {
    label,
    national: { used: nacUsed, available: nacAvailable, total: nacUsed + nacAvailable },
    movements: [],
  };

  const intSection =
    text.match(/Internacional[\s\S]*?(?=Ofertas|Movimientos|Emergencias|$)/)?.[0] ?? "";
  const labels = [...intSection.matchAll(/Cupo (disponible|utilizado|total)/gi)].map((m) =>
    m[1].toLowerCase()
  );
  const usdValues = [...intSection.matchAll(/USD\$?\s*(-?[\d.,]+)/g)].map((m) => m[1]);
  const cupo = new Map(labels.map((l, i): [string, string | undefined] => [l, usdValues[i]]));
  const intAvailable = cupo.get("disponible");
  if (intAvailable) {
    card.international = {
      used: Math.abs(parseUsdAmount(cupo.get("utilizado") ?? "0")),
      available: parseUsdAmount(intAvailable),
      total: parseUsdAmount(cupo.get("total") ?? "0"),
      currency: "USD",
    };
  }

  const nextBilling = text.match(/Próxima facturación\s*(\d{2}\/\d{2}\/\d{4})/)?.[1];
  if (nextBilling) card.nextBillingDate = normalizeDate(nextBilling);
  return card;
}
