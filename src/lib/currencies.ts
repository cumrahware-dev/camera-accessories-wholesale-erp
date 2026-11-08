/**
 * Currencies a product's cost can be held in. A product's cost, wholesale and selling prices are all in ONE currency
 * (Product.currency); stock value is totalled per currency and is never converted.
 */
export const COST_CURRENCIES: { code: string; label: string }[] = [
  { code: 'AED', label: 'AED - UAE Dirham' },
  { code: 'USD', label: 'USD - US Dollar' },
  { code: 'EUR', label: 'EUR - Euro' },
  { code: 'GBP', label: 'GBP - Pound Sterling' },
  { code: 'INR', label: 'INR - Indian Rupee' },
  { code: 'SAR', label: 'SAR - Saudi Riyal' },
  { code: 'CNY', label: 'CNY - Chinese Yuan' },
];

/** A well-formed ISO 4217 style code that Intl can format, upper-cased; null when it is not usable. */
export function normalizeCurrency(v: unknown): string | null {
  const code = String(v ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  try { new Intl.NumberFormat('en-US', { style: 'currency', currency: code }); return code; } catch { return null; }
}
