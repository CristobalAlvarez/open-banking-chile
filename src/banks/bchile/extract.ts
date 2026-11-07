import type { Page } from "puppeteer-core";
import type { BankMovement, CreditCardBalance } from "../../core/types.js";
import { MOVEMENT_SOURCE } from "../../core/types.js";
import { monthYearLabel, normalizeDate, normalizeInstallments } from "../../core/parsing.js";
import type { DebugLog } from "../../core/debug-log.js";
import { apiPost } from "./api.js";
import type {
  ApiCardInfo,
  ApiCardSaldo,
  ApiCartolaMov,
  ApiCartolaResponse,
  ApiFechaFacturacion,
  ApiNoFacturResponse,
  ApiProduct,
  ApiResumenFacturado,
} from "./api.js";
import { BCHILE_MAX_CARTOLA_PAGES } from "./constants.js";
import { openMovementsSection } from "./navigation.js";
import {
  cartolaMovToMovement,
  cartolaTotal,
  chileanDateKey,
  facturadoToMovement,
  hasMoreCartola,
  selectStatementDates,
} from "./parse.js";

export async function fetchAccountMovements(
  page: Page,
  products: ApiProduct[],
  fullName: string,
  rut: string,
  debugLog: string[],
  since?: string
): Promise<{ movements: BankMovement[]; balance?: number }> {
  const accounts = products.filter(
    (p) => p.tipo === "cuenta" || p.tipo === "cuentaCorrienteMonedaLocal"
  );
  const seenNums = new Set<string>();
  const unique = accounts.filter((a) => {
    if (seenNums.has(a.numero)) return false;
    seenNums.add(a.numero);
    return true;
  });
  if (unique.length === 0) return { movements: [] };

  await openMovementsSection(page);

  const movements: BankMovement[] = [];
  let balance: number | undefined;

  for (const acct of unique) {
    debugLog.push(`  Fetching ${acct.descripcionLogo} ${acct.mascara}`);
    const cuentaSeleccionada = {
      nombreCliente: fullName,
      rutCliente: rut,
      numero: acct.numero,
      mascara: acct.mascara,
      selected: true,
      codigoProducto: acct.codigo,
      claseCuenta: acct.claseCuenta,
      moneda: acct.codigoMoneda,
    };

    try {
      await apiPost(page, "movimientos/getConfigConsultaMovimientos", {
        cuentasSeleccionadas: [cuentaSeleccionada],
      });
      const cartola = await apiPost<ApiCartolaResponse>(
        page,
        "bff-pper-prd-cta-movimientos/movimientos/getCartola",
        { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: 1 } }
      );

      const accountMovements: BankMovement[] = [];
      const seen = new Set<string>();
      const sinceKey = chileanDateKey(since);
      let oldestKey: number | undefined;
      let rawFetched = 0;
      let uniqueFetched = 0;
      let info = cartola.pagina?.[0];

      const addPage = (rows: ApiCartolaMov[]): number => {
        let added = 0;
        for (const mov of rows) {
          const key =
            mov.id ??
            `${mov.fechaContable}|${mov.descripcion}|${mov.monto}|${mov.saldo}|${mov.tipo}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const movement = cartolaMovToMovement(mov);
          accountMovements.push(movement);
          const dateKey = chileanDateKey(movement.date);
          if (dateKey !== undefined)
            oldestKey = oldestKey === undefined ? dateKey : Math.min(oldestKey, dateKey);
          added++;
        }
        rawFetched += rows.length;
        uniqueFetched += added;
        return added;
      };

      const firstRows = cartola.movimientos ?? [];
      addPage(firstRows);
      if (balance === undefined && acct.codigoMoneda === "CLP" && firstRows.length > 0)
        balance = firstRows[0].saldo;
      debugLog.push(
        `    → cartola p1: ${firstRows.length} filas, ${uniqueFetched} únicas ` +
          `(total ${cartolaTotal(info) ?? "?"}, masPaginas=${String(info?.masPaginas)})`
      );

      let hasMore = hasMoreCartola(info, uniqueFetched);
      for (let p = 2; hasMore && p <= BCHILE_MAX_CARTOLA_PAGES; p++) {
        const offset = 1 + rawFetched;
        try {
          const next = await apiPost<ApiCartolaResponse>(
            page,
            "bff-pper-prd-cta-movimientos/movimientos/getCartola",
            { cuentaSeleccionada, cabecera: { statusGenerico: true, paginacionDesde: offset } }
          );
          const nextRows = next.movimientos ?? [];
          if (nextRows.length === 0) {
            debugLog.push(`    → cartola p${p} (offset ${offset}): 0 filas; fin`);
            break;
          }
          const added = addPage(nextRows);
          info = next.pagina?.[0] ?? info;
          debugLog.push(
            `    → cartola p${p} (offset ${offset}): ${nextRows.length} filas, ${added} nuevas ` +
              `(total ${cartolaTotal(info) ?? "?"}, masPaginas=${String(info?.masPaginas)})`
          );
          if (added === 0) break;
          hasMore = hasMoreCartola(info, uniqueFetched);
        } catch (err) {
          debugLog.push(
            `    → cartola p${p} (offset ${offset}): error ${err instanceof Error ? err.message : String(err)}`
          );
          hasMore = false;
        }
      }

      if (accountMovements.length > 0) {
        movements.push(...accountMovements);
        debugLog.push(
          `    → cartola ${acct.mascara}: ${uniqueFetched} movimientos, ` +
            `desde ${accountMovements[accountMovements.length - 1]?.date} hasta ${accountMovements[0]?.date}`
        );
      }
      const total = cartolaTotal(info);
      if (total !== undefined && uniqueFetched < total) {
        debugLog.push(`    → ADVERTENCIA: cartola truncada ${uniqueFetched}/${total}`);
      }
      if (sinceKey !== undefined && oldestKey !== undefined) {
        if (oldestKey <= sinceKey) {
          debugLog.push(
            `    → cartola ${acct.mascara}: cubre since ${since} (más antiguo ${accountMovements[accountMovements.length - 1]?.date})`
          );
        } else {
          debugLog.push(
            `    → ADVERTENCIA: cartola no alcanza since ${since}; más antiguo ${accountMovements[accountMovements.length - 1]?.date}`
          );
        }
      }
    } catch (err) {
      debugLog.push(`    → Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { movements, balance };
}

export async function fetchCreditCardData(
  page: Page,
  fullName: string,
  debugLog: DebugLog
): Promise<{ movements: BankMovement[]; creditCards: CreditCardBalance[] }> {
  const movements: BankMovement[] = [];
  const creditCards: CreditCardBalance[] = [];

  let cards: ApiCardInfo[];
  try {
    cards = await apiPost<ApiCardInfo[]>(page, "tarjetas/widget/informacion-tarjetas", {});
  } catch {
    return { movements, creditCards };
  }
  if (cards.length === 0) return { movements, creditCards };

  debugLog.push(`  Found ${cards.length} credit card(s)`);

  for (const card of cards) {
    const cardLabel = `${card.marca} ${card.tipo} ${card.numero.slice(-8)}`.trim();
    const mascara =
      card.numero.replace(/\*/g, "").length <= 4 ? `****${card.numero.slice(-4)}` : card.numero;
    const baseBody = {
      idTarjeta: card.idProducto,
      codigoProducto: "TNM",
      tipoTarjeta: `${card.marca} ${card.tipo}`.trim(),
      mascara,
      nombreTitular: fullName,
    };
    const body = { ...baseBody, tipoCliente: "T" as const };

    const [saldoResult, noFactResult] = await Promise.allSettled([
      apiPost<ApiCardSaldo>(page, "tarjeta-credito-digital/saldo/obtener-saldo", body),
      apiPost<ApiNoFacturResponse>(page, "tarjeta-credito-digital/movimientos-no-facturados", body),
    ]);

    if (saldoResult.status === "fulfilled") {
      const s = saldoResult.value;
      creditCards.push({
        label: cardLabel,
        national: {
          used: s.cupoUtilizadoNacional,
          available: s.cupoDisponibleNacional,
          total: s.cupoTotalNacional,
        },
        international: {
          used: s.cupoUtilizadoInternacional,
          available: s.cupoDisponibleInternacional,
          total: s.cupoTotalInternacional,
          currency: "USD",
        },
      });
    } else {
      creditCards.push({ label: cardLabel });
    }

    if (noFactResult.status === "fulfilled") {
      const nf = noFactResult.value;
      const ccEntry = creditCards[creditCards.length - 1];
      if (nf.fechaProximaFacturacionCalendario)
        ccEntry.nextBillingDate = normalizeDate(nf.fechaProximaFacturacionCalendario);
      const nextDue = nf.fechaProximoVencimiento ?? nf.fechaVencimiento;
      if (nextDue) ccEntry.nextDueDate = normalizeDate(nextDue);
      const unbilledMovs: BankMovement[] = [];
      for (const mov of nf.listaMovNoFactur) {
        const amount = mov.montoCompra < 0 ? Math.abs(mov.montoCompra) : -Math.abs(mov.montoCompra);
        unbilledMovs.push({
          date: normalizeDate(mov.fechaTransaccionString),
          description: mov.glosaTransaccion.trim(),
          amount,
          balance: 0,
          source: MOVEMENT_SOURCE.credit_card_unbilled,
          card: mascara,
          installments: normalizeInstallments(mov.despliegueCuotas),
        });
      }
      // periodExpenses: suma de cargos no facturados (montos negativos → gastos)
      const periodExpensesRaw = nf.gastosPeriodo ?? nf.montoGastosPeriodo;
      ccEntry.periodExpenses =
        periodExpensesRaw !== undefined
          ? periodExpensesRaw
          : unbilledMovs.filter((m) => m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0);
      movements.push(...unbilledMovs);
    }

    // Facturados
    try {
      const fechas = await apiPost<{
        existenEstadosDeCuenta: boolean;
        numeroCuenta: string | null;
        listaNacional: ApiFechaFacturacion[];
        listaInternacional: ApiFechaFacturacion[];
      }>(page, "tarjetas/estadocuenta/fechas-facturacion", baseBody);
      if (fechas.existenEstadosDeCuenta) {
        const ccEntry = creditCards[creditCards.length - 1];
        const numeroCuenta = fechas.numeroCuenta;
        const statementDates = selectStatementDates(fechas);
        if (numeroCuenta && statementDates.length > 0) {
          for (let si = 0; si < statementDates.length; si++) {
            const fechaFacturacion = statementDates[si];
            const resumenBody = { ...baseBody, fechaFacturacion, numeroCuenta };
            const [nacR, intR] = await Promise.allSettled([
              apiPost<ApiResumenFacturado>(
                page,
                "tarjetas/estadocuenta/nacional/resumen-por-fecha",
                resumenBody
              ),
              apiPost<ApiResumenFacturado>(
                page,
                "tarjetas/estadocuenta/internacional/resumen-por-fecha",
                resumenBody
              ),
            ]);
            let statementMovements = 0;
            for (const r of [nacR, intR]) {
              if (r.status !== "fulfilled" || !r.value.existeEstadoCuenta) continue;
              const res = r.value;

              const allTx = [
                ...(res.seccionOperaciones?.transaccionesTarjetas ?? []),
                ...(res.seccionCargosImpuestosAbonos?.transaccionesTarjetas ?? []),
              ];
              for (const tx of allTx) {
                // Skip section-subtotal rows (e.g. "TOTAL PAGOS A LA CUENTA").
                const desc = tx.descripcion.trim().toUpperCase();
                if (desc.startsWith("TOTAL ") && desc.endsWith("A LA CUENTA")) continue;
                movements.push(
                  facturadoToMovement(tx, MOVEMENT_SOURCE.credit_card_billed, mascara)
                );
                statementMovements++;
              }

              // La metadata sale solo del estado más nuevo; los anteriores solo aportan movimientos.
              if (si > 0) continue;
              if (res.resumen?.fechaProximaFacturacion)
                ccEntry.nextBillingDate = normalizeDate(res.resumen.fechaProximaFacturacion);
              if (!ccEntry.nextDueDate && res.resumen?.fechaVencimientoFacturacion)
                ccEntry.nextDueDate = normalizeDate(res.resumen.fechaVencimientoFacturacion);

              if (!ccEntry.lastStatement) {
                const billedAmount =
                  res.resumen?.montoFacturado ??
                  res.totalFacturado ??
                  res.montoTotalFacturado ??
                  res.montoTotal;
                const dueDateRaw =
                  res.resumen?.fechaVencimientoFacturacion ?? res.fechaVencimiento ?? res.fechaPago;
                const minimumPayment =
                  res.resumen?.pagoMinimo ??
                  res.pagoMinimo ??
                  res.montoMinimoPago ??
                  res.montoMinimoAPagar;
                const billingDateRaw = res.resumen?.fechaFacturacionActual ?? fechaFacturacion;
                if (billedAmount && dueDateRaw) {
                  const billingDate = normalizeDate(billingDateRaw);
                  ccEntry.lastStatement = {
                    billingDate,
                    billedAmount,
                    dueDate: normalizeDate(dueDateRaw),
                    minimumPayment,
                  };
                  ccEntry.billingPeriod = monthYearLabel(billingDate);
                }
              }
            }
            debugLog.push(`  TC ${fechaFacturacion}: ${statementMovements} movimiento(s)`);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return { movements, creditCards };
}
