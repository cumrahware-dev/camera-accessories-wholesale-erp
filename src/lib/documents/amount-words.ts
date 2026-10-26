/**
 * An amount in words for the printed total, in the invoice's own currency ("UAE Dirhams One Thousand Two Hundred
 * Thirty-Four and Fifty Fils Only."). Safe for server and client code (no imports).
 *
 * Exact: the amount is read from its 2-decimal text and split into whole units and minor units, so nothing is
 * rounded twice (10.995 -> 11.00 -> "Eleven ... Only", never "ten and one hundred").
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

interface CurrencyWords { major: string; minor: string }
const CURRENCIES: Record<string, CurrencyWords> = {
  AED: { major: 'UAE Dirhams', minor: 'Fils' },
  USD: { major: 'US Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds Sterling', minor: 'Pence' },
  INR: { major: 'Indian Rupees', minor: 'Paise' },
  SAR: { major: 'Saudi Riyals', minor: 'Halalas' },
  QAR: { major: 'Qatari Riyals', minor: 'Dirhams' },
  OMR: { major: 'Omani Rials', minor: 'Baisa' },
  KWD: { major: 'Kuwaiti Dinars', minor: 'Fils' },
  BHD: { major: 'Bahraini Dinars', minor: 'Fils' },
  CNY: { major: 'Chinese Yuan', minor: 'Fen' },
  JPY: { major: 'Japanese Yen', minor: 'Sen' },
  CHF: { major: 'Swiss Francs', minor: 'Rappen' },
  CAD: { major: 'Canadian Dollars', minor: 'Cents' },
  AUD: { major: 'Australian Dollars', minor: 'Cents' },
  SGD: { major: 'Singapore Dollars', minor: 'Cents' },
  PKR: { major: 'Pakistani Rupees', minor: 'Paisa' },
  EGP: { major: 'Egyptian Pounds', minor: 'Piastres' },
  VND: { major: 'Vietnamese Dong', minor: 'Hao' },
};

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** Whole number (as a digit string, so very large amounts stay exact) in words. */
export function integerInWords(digits: string): string {
  const d = digits.replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(d)) return '';
  if (d === '0') return 'Zero';
  const groups: number[] = [];
  for (let i = d.length; i > 0; i -= 3) groups.push(Number(d.slice(Math.max(0, i - 3), i)));
  if (groups.length > SCALES.length) return '';
  const out: string[] = [];
  for (let g = groups.length - 1; g >= 0; g--) if (groups[g]) out.push(`${below1000(groups[g])}${SCALES[g] ? ` ${SCALES[g]}` : ''}`);
  return out.join(' ');
}

export const hasCurrencyWords = (code?: string | null) => !!CURRENCIES[String(code || '').toUpperCase()];

/** "UAE Dirhams One Thousand Two Hundred Thirty-Four and Fifty Fils Only." For a negative amount the words describe its absolute value. */
export function amountInWords(amount: number | string | null | undefined, currency = 'USD'): string {
  const code = String(currency || 'USD').trim().toUpperCase().slice(0, 3) || 'USD';
  const n = Number(amount);
  // whole minor units, rounded half-up once (10.995 -> 1100), then split as text so large amounts stay exact
  const abs = Number.isFinite(n) ? Math.abs(n) : 0;
  const cents = String(Math.round((abs + Number.EPSILON * Math.max(1, abs)) * 100)).padStart(3, '0');
  const whole = cents.slice(0, -2), frac = cents.slice(-2);
  const cw = CURRENCIES[code];
  const wholeWords = integerInWords(whole);
  const minor = Number(frac);
  if (!cw) {
    // a currency without a wording entry: say the code and the exact minor part, never a wrong name
    return `${code} ${wholeWords}${minor ? ` and ${frac}/100` : ''} Only.`;
  }
  const minorWords = minor ? ` and ${below1000(minor)} ${cw.minor}` : '';
  return `${cw.major} ${wholeWords}${minorWords} Only.`;
}
