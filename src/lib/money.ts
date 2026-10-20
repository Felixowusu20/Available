// Money is always stored and added up as whole pesewas (1 cedi = 100 pesewas), never as decimals, so sums are exact.

export const PAYSTACK_FEE_RATE = 0.0195; // Paystack's local-transaction fee in Ghana: 1.95%

/** 5000 -> "GHS 50.00" */
export function formatGhs(pesewas: number): string {
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pesewas));
  return `${sign}GHS ${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
}

/** 5000 -> "50.00" (for spreadsheets, no currency symbol or thousands separator). */
export function plainCedis(pesewas: number): string {
  const sign = pesewas < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pesewas));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** The fee when Paystack did not tell us the exact figure. Never more than the amount itself. */
export function estimateFee(amountPesewas: number): number {
  return Math.min(amountPesewas, Math.round(amountPesewas * PAYSTACK_FEE_RATE));
}

/** `percent` of `amount`, rounded down to a whole pesewa (so shares can never add up to more than the total). */
export function percentOf(amountPesewas: number, percent: number): number {
  return Math.floor((amountPesewas * percent) / 100);
}
