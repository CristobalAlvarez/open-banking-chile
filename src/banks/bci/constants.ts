import { MOVEMENT_SOURCE } from "../../core/types.js";

export const BANK_ID = "bci";
export const BANK_URL = "https://www.bci.cl/personas";

export const LOGIN_URL = "https://www.bci.cl/corporativo/banco-en-linea/personas";

export const BCI_CHECKING_API_PREFIX =
  "https://apilocal.bci.cl/bci-produccion/api-bci/bff-saldosyultimosmovimientoswebpersonas";

export const IFRAME_PATTERNS = {
  content: ["miBanco.jsf", "vistaSupercartola"],
  movements: "fe-saldosultimosmov",
  tcMovements: "fe-mismovimientos",
  tcCupo: "vistaSaldosTDC.jsf",
} as const;

export const TWO_FACTOR_CONFIG = {
  keywords: [
    "bci pass",
    "segundo factor",
    "aprobación en tu app",
    "autorizar en tu app",
    "confirmar en tu app",
  ],
};

export const TC_COMBINATIONS = [
  { tab: "Nacional $", billingType: "No facturados", source: MOVEMENT_SOURCE.credit_card_unbilled },
  { tab: "Nacional $", billingType: "Facturados", source: MOVEMENT_SOURCE.credit_card_billed },
  {
    tab: "Internacional USD",
    billingType: "No facturados",
    source: MOVEMENT_SOURCE.credit_card_unbilled,
  },
  {
    tab: "Internacional USD",
    billingType: "Facturados",
    source: MOVEMENT_SOURCE.credit_card_billed,
  },
];

export const NEXT_PAGE_TEXTS = ["navigate_next", "siguiente"];
export const ACCOUNT_SELECT = "bci-wk-select#cuenta select, select";
