import type { Page } from "puppeteer-core";

import { API_BASE } from "./constants.js";

// ─── API types ───────────────────────────────────────────────────

export interface ApiProduct {
  id: string;
  numero: string;
  mascara: string;
  codigo: string;
  codigoMoneda: string;
  label: string;
  tipo: string;
  claseCuenta: string;
  tarjetaHabiente: string | null;
  descripcionLogo: string;
  tipoCliente: string;
}
export interface ApiCardInfo {
  titular: boolean;
  marca: string;
  tipo: string;
  idProducto: string;
  numero: string;
}
export interface ApiCardSaldo {
  cupoTotalNacional: number;
  cupoUtilizadoNacional: number;
  cupoDisponibleNacional: number;
  cupoTotalInternacional: number;
  cupoUtilizadoInternacional: number;
  cupoDisponibleInternacional: number;
}
export interface ApiMovNoFactur {
  origenTransaccion: string;
  fechaTransaccionString: string;
  /** En pesos para origen NAC; en USD (con decimales) para origen INT. */
  montoCompra: number;
  glosaTransaccion: string;
  despliegueCuotas: string;
  /** ISO 4217 numérico de la moneda de origen: 152 = CLP, 840 = USD. */
  codigoMonedaOrigen?: string | number;
}
export interface ApiNoFacturResponse {
  fechaProximaFacturacionCalendario: string;
  fechaProximoVencimiento?: string;
  fechaVencimiento?: string;
  gastosPeriodo?: number;
  montoGastosPeriodo?: number;
  listaMovNoFactur: ApiMovNoFactur[];
}
export interface ApiFechaFacturacion {
  fechaFacturacion: string;
  existeEstadoCuentaNacional: string;
  existeEstadoCuentaInternacional: string;
}
export interface ApiTransaccionFacturada {
  /** Algunas filas (p. ej. avances) vienen sin fecha: `null`. */
  fechaTransaccionString: string | null;
  montoTransaccion: number;
  descripcion: string;
  cuotas: string;
  grupo: string;
}
interface ApiResumenNested {
  montoFacturado?: number;
  pagoMinimo?: number;
  fechaFacturacionActual?: string;
  fechaVencimientoFacturacion?: string;
  fechaProximaFacturacion?: string;
}
/** Movimiento del estado de cuenta internacional (siempre en USD). */
export interface ApiTransaccionInternacional {
  fechaTransaccionString: string;
  descripcion: string;
  /** USD: positivo = cargo, negativo = pago o abono. */
  montoDolar: number;
  /** "generico"/"pagos" en movimientos; títulos en mayúsculas ("TOTAL DE COMPRAS") en subtotales. */
  grupo: string;
}
interface ApiSeccionInternacional {
  transaccionesTarjetas: ApiTransaccionInternacional[] | null;
}
export interface ApiResumenFacturado {
  existeEstadoCuenta: boolean;
  seccionOperaciones?: { transaccionesTarjetas: ApiTransaccionFacturada[] };
  seccionCargosImpuestosAbonos?: { transaccionesTarjetas: ApiTransaccionFacturada[] | null };
  seccionPagos?: ApiSeccionInternacional;
  seccionCompras?: ApiSeccionInternacional;
  seccionComisiones?: ApiSeccionInternacional;
  resumen?: ApiResumenNested;
  totalFacturado?: number;
  montoTotalFacturado?: number;
  montoTotal?: number;
  fechaVencimiento?: string;
  fechaPago?: string;
  pagoMinimo?: number;
  montoMinimoPago?: number;
  montoMinimoAPagar?: number;
}
export interface ApiCartolaMov {
  id?: string;
  descripcion: string;
  monto: number;
  /** El portal lo manda como string ("1234567") aunque el tipo diga número. */
  saldo: number | string;
  tipo: string;
  fechaContable: string;
}
interface ApiCartolaPageInfo {
  totalRegistros?: number | string;
  cantidadRegistros?: number | string;
  indiceInicio?: number | string;
  indiceTermino?: number | string;
  masPaginas?: boolean | string;
}
export type ApiCartolaResponse = { movimientos?: ApiCartolaMov[]; pagina?: ApiCartolaPageInfo[] };

// ─── API helpers ─────────────────────────────────────────────────

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  return await page.evaluate(async (url: string) => {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    const xsrf = m ? decodeURIComponent(m[1]) : "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
    const r = await fetch(url, { credentials: "include", headers });
    if (!r.ok) throw new Error(`API GET ${url} → ${r.status}`);
    return r.json();
  }, `${API_BASE}/${path}`);
}

export async function apiPost<T>(page: Page, path: string, body: unknown = {}): Promise<T> {
  return await page.evaluate(
    async (url: string, bodyStr: string) => {
      const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
      const xsrf = m ? decodeURIComponent(m[1]) : "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers,
        body: bodyStr,
      });
      if (!r.ok) throw new Error(`API POST ${url} → ${r.status}`);
      return r.json();
    },
    `${API_BASE}/${path}`,
    JSON.stringify(body)
  );
}
