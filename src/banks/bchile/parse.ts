import type { BankMovement, MovementSource } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { normalizeDate, normalizeInstallments } from "../../core/parsing.js";

import type {
  ApiCartolaMov,
  ApiMovNoFactur,
  ApiTransaccionFacturada,
  ApiTransaccionInternacional,
} from "./api.js";

/** BChile manda los flags como "S"/"N" o boolean; `Boolean("N")` sería true. */
export function parseCartolaFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = (typeof value === "string" || typeof value === "number" ? String(value) : "")
    .trim()
    .toLowerCase();
  return ["s", "si", "sí", "y", "yes", "true", "1"].includes(normalized);
}

export function cartolaTotal(
  info: { totalRegistros?: number | string } | undefined
): number | undefined {
  const total = parseInt(String(info?.totalRegistros ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** `totalRegistros` manda sobre `masPaginas`: si faltan registros, hay que seguir paginando. */
export function hasMoreCartola(
  info: { totalRegistros?: number | string; masPaginas?: boolean | string } | undefined,
  fetched: number
): boolean {
  if (fetched === 0) return false;
  const total = cartolaTotal(info);
  if (total !== undefined && fetched < total) return true;
  return parseCartolaFlag(info?.masPaginas);
}

/** Las fechas vienen newest-first; se piden las dos últimas para no dejar huecos de facturación. */
export function selectStatementDates(
  fechas:
    | {
        listaNacional?: Array<{ fechaFacturacion: string }>;
        listaInternacional?: Array<{ fechaFacturacion: string }>;
      }
    | undefined,
  limit = 2
): string[] {
  const dates = [...(fechas?.listaNacional ?? []), ...(fechas?.listaInternacional ?? [])]
    .map((f) => f.fechaFacturacion)
    .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
  return [...new Set(dates)].sort((a, b) => b.localeCompare(a)).slice(0, limit);
}

/** dd-mm-yyyy → YYYYMMDD comparable; undefined si no es una fecha del scraper. */
export function chileanDateKey(value: string | undefined): number | undefined {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value ?? "");
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : undefined;
}

export function cartolaMovToMovement(mov: ApiCartolaMov): BankMovement {
  return {
    date: normalizeDate(mov.fechaContable),
    description: mov.descripcion.trim(),
    amount: mov.tipo === "cargo" ? -Math.abs(mov.monto) : Math.abs(mov.monto),
    balance: Number(mov.saldo) || 0,
    source: MOVEMENT_SOURCE.account,
  };
}

/**
 * Movimiento del estado de cuenta nacional. Si la fila no trae fecha (el portal la manda `null` en
 * algunos avances), usa `fallbackDate` —la fecha de facturación del estado— en lugar de fallar.
 */
export function facturadoToMovement(
  tx: ApiTransaccionFacturada,
  source: MovementSource,
  cardMask?: string,
  fallbackDate?: string
): BankMovement {
  return {
    date: normalizeDate(tx.fechaTransaccionString ?? fallbackDate ?? ""),
    description: (tx.descripcion ?? "").trim(),
    amount: tx.grupo === "pagos" ? Math.abs(tx.montoTransaccion) : -Math.abs(tx.montoTransaccion),
    balance: 0,
    source,
    card: cardMask,
    installments: normalizeInstallments(tx.cuotas),
  };
}

/**
 * Filas de subtotal del estado de cuenta nacional que no son movimientos:
 * "TOTAL PAGOS A LA CUENTA", "TOTAL TARJETA XXXXXXXXXXXX1234", etc.
 */
export function isNationalSubtotal(descripcion: string | null | undefined): boolean {
  const desc = (descripcion ?? "").trim().toUpperCase();
  return (
    (desc.startsWith("TOTAL ") && desc.endsWith("A LA CUENTA")) || desc.startsWith("TOTAL TARJETA ")
  );
}

/**
 * Movimiento no facturado de una tarjeta. Los internacionales (origen INT, moneda de origen 840)
 * vienen en USD con decimales: se marcan con `currency: "USD"` para no confundirlos con pesos.
 */
export function noFacturadoToMovement(mov: ApiMovNoFactur, cardMask: string): BankMovement {
  const isUsd = mov.origenTransaccion === "INT" && String(mov.codigoMonedaOrigen) === "840";
  return {
    date: normalizeDate(mov.fechaTransaccionString),
    description: mov.glosaTransaccion.trim(),
    amount: mov.montoCompra < 0 ? Math.abs(mov.montoCompra) : -Math.abs(mov.montoCompra),
    balance: 0,
    source: MOVEMENT_SOURCE.credit_card_unbilled,
    card: cardMask,
    installments: normalizeInstallments(mov.despliegueCuotas),
    ...(isUsd ? { currency: "USD" as const } : {}),
  };
}

/**
 * Los subtotales del estado internacional ("TOTAL DE COMPRAS", "COMISIONES, OTROS CARGOS…") vienen
 * como filas más con el `grupo` en mayúsculas; los movimientos reales usan "generico" o "pagos".
 */
export function isInternationalSubtotal(tx: ApiTransaccionInternacional): boolean {
  return (
    /^[A-ZÁÉÍÓÚÑ0-9 ,.-]{6,}$/.test((tx.grupo ?? "").trim()) ||
    (tx.descripcion ?? "").trim().toUpperCase().startsWith("TOTAL ")
  );
}

/** Movimiento del estado de cuenta internacional facturado: siempre USD. */
export function facturadoInternacionalToMovement(
  tx: ApiTransaccionInternacional,
  cardMask: string
): BankMovement {
  return {
    date: normalizeDate(tx.fechaTransaccionString),
    description: (tx.descripcion ?? "").trim(),
    // montoDolar: positivo = cargo, negativo = pago o abono.
    amount: -tx.montoDolar,
    balance: 0,
    source: MOVEMENT_SOURCE.credit_card_billed,
    card: cardMask,
    currency: "USD",
  };
}
