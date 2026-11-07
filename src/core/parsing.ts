import { CARD_OWNER, type CardOwner } from "./types.js";

/** Formatea un RUT chileno (ej: "123456789" → "12.345.678-9") */
export function formatRut(rut: string): string {
  const clean = rut.replace(/[.-]/g, "");
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted}-${dv}`;
}

/**
 * Normaliza una cantidad de periodos históricos: `fallback` si no es un número válido,
 * truncada a entero y acotada a [0, max]. `0` es un valor válido (= sin periodos extra).
 */
export function resolveMonths(value: number | undefined, fallback: number, max: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
  return Math.min(Math.max(n, 0), max);
}

/** Mapa de meses en español a número */
const MONTHS_MAP: Record<string, string> = {
  ene: "01",
  feb: "02",
  mar: "03",
  abr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  ago: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dic: "12",
};

/**
 * Parsea un monto en formato chileno a número entero.
 * Maneja: "$1.234.567", "-$50.000", "$1.234,56" (CLP con decimales).
 */
export function parseChileanAmount(text: string): number {
  const clean = text.replace(/[^0-9.,-]/g, "");
  if (!clean) return 0;
  const isNegative = clean.startsWith("-") || text.includes("-$");
  // Remove thousand separators (dots), convert decimal comma to dot
  const normalized = clean.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
  const amount = parseInt(normalized, 10) || 0;
  return isNegative ? -amount : amount;
}

/**
 * Parsea un monto en dólares a número con decimales.
 * Maneja: "USD 47,61", "USD 1.234,56", "USD -34,36".
 */
export function parseUsdAmount(text: string): number {
  const clean = text.replace(/[^0-9.,-]/g, "");
  if (!clean) return 0;
  const isNegative = clean.startsWith("-") || text.includes("-USD");
  const normalized = clean.replace(/-/g, "").replace(/\./g, "").replace(",", ".");
  const amount = parseFloat(normalized) || 0;
  return isNegative ? -amount : amount;
}

/**
 * Normaliza fechas a formato DD-MM-YYYY.
 * Soporta: dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy, dd/mm, "9 mar 2026" y yyyy-mm-dd (con hora opcional).
 */
export function normalizeDate(raw: string): string {
  const value = raw.trim();

  // yyyy-mm-dd, con hora opcional ("2026-03-22T14:30:00")
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;

  // dd/mm/yyyy, dd.mm.yyyy, dd-mm-yyyy (con año 2 o 4 dígitos)
  const fullMatch = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, "0");
    const month = fullMatch[2].padStart(2, "0");
    const year = fullMatch[3].length === 2 ? `20${fullMatch[3]}` : fullMatch[3];
    return `${day}-${month}-${year}`;
  }

  // dd/mm (sin año, asume año actual)
  const shortMatch = value.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (shortMatch) {
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    return `${day}-${month}-${new Date().getFullYear()}`;
  }

  // "9 mar 2026" (día mes_texto año)
  const parts = value.split(/\s+/);
  if (parts.length >= 2) {
    const monthKey = parts.length === 3 ? parts[1].toLowerCase() : parts[0].toLowerCase();
    if (MONTHS_MAP[monthKey]) {
      if (parts.length === 3) {
        return `${parts[0].padStart(2, "0")}-${MONTHS_MAP[monthKey]}-${parts[2]}`;
      }
      const dayPart = parts.find((p) => /^\d{1,2}$/.test(p));
      if (dayPart) {
        return `${dayPart.padStart(2, "0")}-${MONTHS_MAP[monthKey]}-${new Date().getFullYear()}`;
      }
    }
  }

  return value;
}

/**
 * Normaliza cuotas a formato NN/NN. Reconoce "1/3", "01/1", "3 de 12" y textos que lo contienen
 * ("Cuota 2/12"). Devuelve `undefined` si no hay cuotas reconocibles ("3 Cuotas", "", "N/A"):
 * el contrato de `BankMovement.installments` es NN/NN o ausente, nunca texto libre.
 */
export function normalizeInstallments(raw?: string): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(?<![\d/])(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})(?![\d/])/i);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}`;
}

/**
 * Normaliza el campo owner a valores fijos.
 * "Titular" / "TITULAR" → "titular", "Adicional" / "ADICIONAL" → "adicional"
 */
export function normalizeOwner(raw?: string): CardOwner | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower.includes("adicional")) return CARD_OWNER.adicional;
  if (lower.includes("titular")) return CARD_OWNER.titular;
  return CARD_OWNER.titular; // default si hay owner pero no matchea
}

/**
 * Converts a DD-MM-YYYY date to a human-readable month+year label.
 * Example: "19-03-2026" → "Marzo 2026"
 */
export function monthYearLabel(dateStr: string): string {
  const monthNames = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return dateStr;
  return `${monthNames[monthIdx]} ${parts[2]}`;
}
