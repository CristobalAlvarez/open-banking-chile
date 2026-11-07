/** Identificador del banco en la API pública. */
export const BANK_ID = "scotiabank";

/** Portal de personas de Scotiabank Chile. */
export const BANK_URL = "https://www.scotiabank.cl";

/** Selectores propios del formulario de login de Scotiabank. */
export const LOGIN_SELECTORS = {
  rutSelectors: ["#inputDni", 'input[name="inputDni"]', 'input[id*="Dni"]', 'input[name*="Dni"]'],
  passwordSelectors: [
    "#inputPassword",
    'input[name="inputPassword"]',
    'input[id*="Password"]',
    'input[name*="Password"]',
  ],
  rutFormat: "dash" as const,
};
