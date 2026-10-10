/**
 * How a scanned supplier invoice maps onto the ERP purchase model, decided from the document's OWN arithmetic.
 *
 * The purchase model taxes each line after its own discount. A supplier may instead calculate tax AFTER an invoice-level
 * discount. Which one this invoice used is read from its printed tax, never assumed:
 *   AS_PRINTED          tax on the lines as they are; invoice discount stays an invoice-level deduction
 *   DISCOUNT_BEFORE_TAX the printed tax only reproduces when the invoice discount is taken off first, so the discount
 *                       is spread over the lines (pro rata) and tax follows the discounted lines
 * Nothing is rounded to whole numbers and no printed total is overwritten: if neither reproduces the document, the
 * plan says so and the difference is shown to the reviewer.
 */
import { dec, lineNet, round2, sum2, taxOn, within } from '@/lib/money';

export interface PlanLine { quantity: number; unitPrice: number; discount: number; taxRate: number }
export interface PlanDoc { discountAmount: number; taxAmount: number; freightAmount: number; otherCharges: number; totalAmount: number; lineItems: PlanLine[] }
export interface PurchasePlan {
  mode: 'AS_PRINTED' | 'DISCOUNT_BEFORE_TAX';
  lines: { discountAmount: number; net: number; tax: number }[];
  headerDiscount: number;
  subtotal: number; taxAmount: number; grandTotal: number;
  reconciles: boolean;
  notes: string[];
  /** Printed tax exists but no line carries a tax %: a rate that reproduces it, for a person to apply. */
  suggestedTaxRate: number | null;
}

const tol = (n: number) => Math.max(0.05, 0.01 * n);

function build(doc: PlanDoc, mode: PurchasePlan['mode']): Omit<PurchasePlan, 'notes' | 'suggestedTaxRate' | 'reconciles'> {
  const base = doc.lineItems.map((l) => lineNet(l.quantity, l.unitPrice, l.discount));
  const baseSum = sum2(base);
  let shares = base.map(() => 0);
  // Line discounts that add up to the printed document discount are the SAME money shown twice (once per line, once in the totals).
  const lineDiscSum = sum2(doc.lineItems.map((l) => l.discount));
  const sameMoney = lineDiscSum > 0 && within(lineDiscSum, doc.discountAmount, 0.02);
  let headerDiscount = sameMoney ? 0 : round2(doc.discountAmount);
  if (mode === 'DISCOUNT_BEFORE_TAX' && headerDiscount > 0 && baseSum > 0) {
    shares = base.map((b) => round2(dec(headerDiscount).times(b).div(baseSum)));
    const drift = round2(dec(headerDiscount).minus(sum2(shares)));
    if (drift !== 0) { const k = base.indexOf(Math.max(...base)); shares[k] = round2(dec(shares[k]).plus(drift)); }
    headerDiscount = 0;
  }
  const lines = doc.lineItems.map((l, i) => {
    const net = round2(dec(base[i]).minus(shares[i]));
    return { discountAmount: round2(dec(l.discount).plus(shares[i])), net, tax: taxOn(net, l.taxRate || 0) };
  });
  const subtotal = sum2(lines.map((l) => l.net));
  const taxAmount = sum2(lines.map((l) => l.tax));
  const grandTotal = round2(dec(subtotal).minus(headerDiscount).plus(taxAmount).plus(doc.freightAmount).plus(doc.otherCharges));
  return { mode, lines, headerDiscount, subtotal, taxAmount, grandTotal };
}

export function planPurchase(doc: PlanDoc): PurchasePlan {
  const n = doc.lineItems.length;
  const notes: string[] = [];
  const candidates = [build(doc, 'AS_PRINTED'), build(doc, 'DISCOUNT_BEFORE_TAX')];
  const fits = candidates.filter((c) => doc.totalAmount > 0 && within(c.grandTotal, doc.totalAmount, tol(n)));
  // prefer leaving the discount where the document put it
  const chosen = fits[0] ?? candidates[0];
  if (chosen.mode === 'DISCOUNT_BEFORE_TAX' && doc.discountAmount > 0) {
    notes.push(`The document's tax was calculated after its ${doc.discountAmount.toFixed(2)} invoice discount, so the discount is spread over the lines (pro rata) before tax.`);
  }
  let suggestedTaxRate: number | null = null;
  if (doc.taxAmount > 0 && doc.lineItems.length && doc.lineItems.every((l) => !(l.taxRate > 0))) {
    const baseA = candidates[0].subtotal, baseB = round2(dec(baseA).minus(candidates[0].headerDiscount));
    for (const b of [baseB, baseA]) {
      if (b <= 0) continue;
      const r = round2(dec(doc.taxAmount).div(b).times(100));
      if (within(taxOn(b, r), doc.taxAmount, 0.05)) { suggestedTaxRate = r; break; }
    }
  }
  // Suppliers round tax once on the invoice; the ERP rounds per line. A few cents of difference is carried on the
  // largest line's tax so the draft carries the printed total, and it is disclosed.
  if (fits.length > 0) {
    const drift = round2(dec(doc.totalAmount).minus(chosen.grandTotal));
    if (drift !== 0 && Math.abs(drift) <= 0.05 && chosen.lines.length) {
      const k = chosen.lines.reduce((m, l, i, a) => (l.net > a[m].net ? i : m), 0);
      chosen.lines[k] = { ...chosen.lines[k], tax: round2(dec(chosen.lines[k].tax).plus(drift)) };
      chosen.taxAmount = sum2(chosen.lines.map((l) => l.tax));
      chosen.grandTotal = round2(dec(chosen.grandTotal).plus(drift));
      notes.push(`Tax was rounded by ${Math.abs(drift).toFixed(2)} on line ${k + 1} to match the supplier's printed total (suppliers round tax once per invoice).`);
    }
  }
  return { ...chosen, reconciles: fits.length > 0, notes, suggestedTaxRate };
}
