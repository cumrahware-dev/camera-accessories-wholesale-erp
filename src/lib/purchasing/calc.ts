/**
 * The ONE purchase-invoice money calculation. Pure and dependency-free so the server (validation, posting, API) and the
 * browser (live form summary, details page, posting confirmation) run the very same code.
 *
 * Arithmetic is exact: numbers are converted through their decimal text to scaled BigInt integers (quantity 3 dp, cost up to
 * 4 dp, money 2 dp), rounded half-up to the currency's 2 places only where an amount is stated. No floating point sums.
 *
 *   line (VAT-exclusive costs)  net = round2(qty x cost - discount)         tax = round2(net x rate)
 *   line (VAT-inclusive costs)  gross = round2(qty x cost - discount)       tax = round2(gross x rate / (100 + rate)), net = gross - tax
 *   invoice  subtotal = sum(net)   VAT = sum(line tax)   grand total (supplier payable) = subtotal - discount + VAT + freight + other
 *   VAT recovery  non-recoverable VAT = round2(VAT x non-recoverable %)   recoverable VAT = VAT - non-recoverable
 *   inventory cost = subtotal - discount + freight + other + non-recoverable VAT      (recoverable VAT is a tax receivable, never stock cost)
 *   journal  Dr Inventory (inventory cost) + Dr Input VAT (recoverable) = Cr Accounts Payable (grand total)
 */
type Num = number | string | null | undefined;

const P = 10; // working scale: 1e-10
const SC = BigInt('1' + '0'.repeat(P));
const ZERO = BigInt(0);

/** exact scaled integer of a number's decimal text; non-numeric -> 0 */
function sc(v: Num): bigint {
  if (v === null || v === undefined || v === '') return ZERO;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return ZERO;
  let s = typeof v === 'string' ? v.trim() : String(n);
  if (/e/i.test(s)) s = n.toFixed(P);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace(/^[-+]/, '').split('.');
  const frac = (f + '0'.repeat(P)).slice(0, P);
  const out = BigInt(i || '0') * SC + BigInt(frac || '0');
  return neg ? -out : out;
}
/** scaled value -> integer cents, rounded half away from zero */
function cents(x: bigint): bigint {
  const unit = SC / BigInt(100);
  const neg = x < ZERO;
  const a = neg ? -x : x;
  const q = (a + unit / BigInt(2)) / unit;
  return neg ? -q : q;
}
const fromCents = (c: bigint): number => Number(c) / 100;
const toCents = (v: Num): bigint => cents(sc(v));
const mul = (a: bigint, b: bigint): bigint => (a * b) / SC;
const div = (a: bigint, b: bigint): bigint => (b === ZERO ? ZERO : (a * SC) / b);

export interface CalcLineInput { quantity: Num; unitCost: Num; taxRate?: Num; discountAmount?: Num; /** supplier-stated line tax; used only when within 5 cents of the computed tax */ taxAmount?: Num }
export interface CalcHeaderInput { discountAmount?: Num; freightAmount?: Num; otherCharges?: Num; pricesIncludeTax?: boolean; /** share of the VAT that cannot be reclaimed, 0-100 (0 = fully recoverable) */ nonRecoverableVatPercent?: Num; /** the invoice VAT as saved; used instead of the recalculated one (callers check it is within a few cents) */ vatOverride?: Num }
export interface CalcLine { net: number; tax: number; gross: number; taxRate: number }

/** One line. `net` is what is stored as the line total (excl. tax); `gross` = net + tax. */
export function calcLine(l: CalcLineInput, pricesIncludeTax = false): CalcLine {
  const rate = sc(l.taxRate);
  const amount = mul(sc(l.quantity), sc(l.unitCost)) - sc(l.discountAmount); // exact, before rounding
  let netC: bigint, taxC: bigint;
  if (pricesIncludeTax) {
    const grossC = cents(amount);
    // gross x rate / (100 + rate), computed on the scaled value
    taxC = cents(div(mul(grossC * (SC / BigInt(100)), rate), BigInt(100) * SC + rate));
    netC = grossC - taxC;
  } else {
    netC = cents(amount);
    taxC = cents(div(mul(netC * (SC / BigInt(100)), rate), BigInt(100) * SC));
  }
  if (l.taxAmount !== undefined && l.taxAmount !== null && l.taxAmount !== '' && Number.isFinite(Number(l.taxAmount))) {
    const diff = toCents(l.taxAmount) - taxC;
    if ((diff < ZERO ? -diff : diff) <= BigInt(5)) {
      if (pricesIncludeTax) { netC = netC + taxC - toCents(l.taxAmount); }
      taxC = toCents(l.taxAmount);
    }
  }
  return { net: fromCents(netC), tax: fromCents(taxC), gross: fromCents(netC + taxC), taxRate: Number(l.taxRate) || 0 };
}

export interface VatBand { taxRate: number; taxable: number; vat: number }
export interface PurchaseSummary {
  /** net purchase amount: sum of line totals excl. VAT, after line discounts */
  subtotal: number;
  /** invoice-level discount */
  discount: number;
  /** taxable amount: the net lines (an invoice-level discount is not a reduction of the supplier's VAT) */
  taxable: number;
  vatByRate: VatBand[];
  vat: number;
  freight: number;
  otherCharges: number;
  /** gross supplier invoice total = the supplier payable */
  grandTotal: number;
  nonRecoverableVatPercent: number;
  recoverableVat: number;
  nonRecoverableVat: number;
  /** what is booked into stock */
  inventoryCost: number;
}

/** Totals from per-line amounts that were already calculated (draft form, or the saved lines of an invoice). */
export function summarize(lines: { net: Num; tax: Num; taxRate?: Num }[], h: CalcHeaderInput = {}): PurchaseSummary {
  let sub = ZERO, vat = ZERO;
  // per rate: exact (unrounded) tax, sum of the rounded line taxes, and whether any line carries a supplier-stated tax
  const bands = new Map<number, { taxable: bigint; exact: bigint; rounded: bigint; stated: boolean }>();
  for (const l of lines) {
    const n = toCents(l.net), t = toCents(l.tax);
    sub += n;
    const r = Number(l.taxRate) || 0;
    const b = bands.get(r) || { taxable: ZERO, exact: ZERO, rounded: ZERO, stated: false };
    const exact = mul(n * (SC / BigInt(100)), sc(r)) / BigInt(100);
    b.taxable += n; b.exact += exact; b.rounded += t;
    if (cents(exact) !== t) b.stated = true;
    bands.set(r, b);
  }
  // VAT-exclusive costs: the invoice VAT is the tax on the band's total (the supplier's own method), not a sum of
  // per-line roundings that can drift by a cent; VAT-inclusive costs or a supplier-stated line tax: the sum of the lines.
  const bandVat = (b: { exact: bigint; rounded: bigint; stated: boolean }) => (h.pricesIncludeTax || b.stated ? b.rounded : cents(b.exact));
  const vatByRate = Array.from(bands.entries()).sort((a, b) => a[0] - b[0]).map(([taxRate, b]) => ({ taxRate, taxable: fromCents(b.taxable), vat: fromCents(bandVat(b)) }));
  for (const b of Array.from(bands.values())) vat += bandVat(b);
  if (h.vatOverride !== undefined && h.vatOverride !== null && h.vatOverride !== '') vat = toCents(h.vatOverride);
  const disc = toCents(h.discountAmount), fr = toCents(h.freightAmount), oth = toCents(h.otherCharges);
  const pct = Math.min(100, Math.max(0, Number(h.nonRecoverableVatPercent) || 0));
  const nonRec = cents(div(mul(vat * (SC / BigInt(100)), sc(pct)), BigInt(100) * SC));
  const grand = sub - disc + vat + fr + oth;
  return {
    subtotal: fromCents(sub), discount: fromCents(disc), taxable: fromCents(sub), vatByRate,
    vat: fromCents(vat), freight: fromCents(fr), otherCharges: fromCents(oth), grandTotal: fromCents(grand),
    nonRecoverableVatPercent: pct, recoverableVat: fromCents(vat - nonRec), nonRecoverableVat: fromCents(nonRec),
    inventoryCost: fromCents(sub - disc + fr + oth + nonRec),
  };
}

/** Raw inputs -> per-line results + summary (used by validation and by the live form). */
export function calcInvoice(lines: CalcLineInput[], h: CalcHeaderInput = {}) {
  const calc = lines.map((l) => calcLine(l, !!h.pricesIncludeTax));
  return { lines: calc, summary: summarize(calc, h) };
}

/** The breakdown of a SAVED invoice (header + lines as stored). The details page, the posting confirmation and the posting
 *  transaction all use this, so they cannot disagree. Falls back to the stored VAT, as supplied/verified at save time. */
export function invoiceFinancials(inv: { items: { lineTotal: Num; taxAmount: Num; taxRate?: Num }[]; discountAmount?: Num; freightAmount?: Num; otherCharges?: Num; pricesIncludeTax?: boolean | null; nonRecoverableVatPercent?: Num; taxAmount?: Num }): PurchaseSummary {
  return summarize(inv.items.map((i) => ({ net: i.lineTotal, tax: i.taxAmount, taxRate: i.taxRate })), {
    discountAmount: inv.discountAmount, freightAmount: inv.freightAmount, otherCharges: inv.otherCharges,
    pricesIncludeTax: !!inv.pricesIncludeTax, nonRecoverableVatPercent: inv.nonRecoverableVatPercent, vatOverride: inv.taxAmount,
  });
}
