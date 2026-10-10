/** Pre-conversion validation. Pure: works on plain data, no database access. */
import { dec, lineNet, round2, sum2, taxOn, within } from '@/lib/money';
import { planPurchase } from './purchase-plan';
import { DESTINATIONS, DestinationKey, OcrDocType, partyFor } from './doc-types';

export interface ValidatableDoc {
  documentType: OcrDocType;
  documentNumber: string;
  documentDate: Date | string | null;
  currency: string;
  vatNumber: string;
  subtotal: number; discountAmount: number; taxAmount: number; freightAmount: number; otherCharges: number; totalAmount: number;
  matchedCustomerId: string | null;
  matchedSupplierId: string | null;
  lineItems: { description: string; quantity: number; unitPrice: number; discount: number; taxRate: number; taxAmount: number; total: number; matchedProductId: string | null }[];
}
export interface Discrepancy { scope: 'line' | 'document'; line?: number; field: string; expected: number; actual: number; message: string; suggestion?: { type: 'APPLY_TAX_RATE'; rate: number } }
export interface ValidationResult { errors: string[]; warnings: string[]; discrepancies: Discrepancy[] }

const r2 = round2;
/** Totals may differ by a cent or two per line because suppliers round each line themselves. */
const tolerance = (lines: number) => Math.max(0.05, 0.01 * lines);

export function validateForConversion(doc: ValidatableDoc, destination: DestinationKey, companyCurrency: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const discrepancies: Discrepancy[] = [];
  const dest = DESTINATIONS[destination];
  const party = partyFor(doc.documentType);

  if (!dest.available) errors.push(`${dest.label} cannot be created: ${dest.note}`);
  if (!doc.documentNumber.trim()) errors.push('Document number is required.');

  const date = doc.documentDate ? new Date(doc.documentDate) : null;
  if (!date || isNaN(date.getTime())) errors.push('Document date is required.');
  else if (date.getTime() > Date.now() + 86400000) warnings.push('Document date is in the future.');

  if (destination === 'PURCHASE_BILL') {
    if (!doc.matchedSupplierId) errors.push('Supplier is required before converting to Purchase Bill. Select an existing supplier or create one.');
  } else {
    if (!doc.matchedCustomerId) errors.push(`Customer is required before converting to ${dest.label}. Select an existing customer or create one.`);
  }

  if (!/^[A-Za-z]{3}$/.test(doc.currency.trim())) errors.push('Currency is required (3-letter code, e.g. USD).');
  else if (destination !== 'PURCHASE_BILL' && destination !== 'SERVICE_INVOICE' && companyCurrency && doc.currency.trim().toUpperCase() !== companyCurrency.toUpperCase()) {
    errors.push(`This ERP issues documents in ${companyCurrency.toUpperCase()}; the document is in ${doc.currency.trim().toUpperCase()}. Currency conversion is not supported.`);
  }

  if (doc.lineItems.length === 0) errors.push('At least one line item is required.');
  doc.lineItems.forEach((l, i) => {
    const n = i + 1;
    if (!l.description.trim()) errors.push(`Line ${n}: description is required.`);
    if (!(l.quantity > 0)) errors.push(`Line ${n}: quantity must be greater than 0.`);
    if (destination === 'PURCHASE_BILL' && (!Number.isInteger(l.quantity) || l.quantity < 1)) {
      errors.push(`Line ${n}: quantity must be a whole number of at least 1.`);
    }
    if (!(l.unitPrice >= 0)) errors.push(`Line ${n}: unit price cannot be negative.`);
    if (!(l.taxRate >= 0 && l.taxRate <= 100)) errors.push(`Line ${n}: tax must be between 0% and 100%.`);
    if (['TAX_INVOICE', 'QUOTATION', 'PROFORMA', 'PURCHASE_BILL'].includes(destination) && !l.matchedProductId) {
      errors.push(`Line ${n}: product not found in the catalogue. Select an existing product or create it before converting.`);
    }
  });

  // Line arithmetic: quantity x unit price - line discount (+ line tax when the printed amount includes it) = printed line total.
  const lineIssues: string[] = [];
  doc.lineItems.forEach((l, i) => {
    if (!(l.total > 0 || l.total < 0)) return; // no printed total to compare with
    const net = lineNet(l.quantity, l.unitPrice, l.discount);
    const withTax = round2(dec(net).plus(l.taxAmount || taxOn(net, l.taxRate)));
    if (!within(net, l.total, 0.02) && !within(withTax, l.total, 0.02)) {
      const msg = `Line ${i + 1}: quantity ${l.quantity} x ${l.unitPrice.toFixed(2)}${l.discount ? ` - ${l.discount.toFixed(2)} discount` : ''} = ${net.toFixed(2)}, but the document shows ${l.total.toFixed(2)}.`;
      lineIssues.push(msg);
      discrepancies.push({ scope: 'line', line: i + 1, field: 'total', expected: net, actual: l.total, message: msg });
    }
  });

  // Header arithmetic. The ERP records its own computed totals, so a document that does not add up
  // is almost always an OCR misread and must be corrected first. Nothing is overwritten silently.
  const n = doc.lineItems.length;
  const lineNetSum = sum2(doc.lineItems.map((l) => lineNet(l.quantity, l.unitPrice, l.discount)));
  const lineTaxSum = sum2(doc.lineItems.map((l) => (l.taxAmount > 0 ? l.taxAmount : taxOn(lineNet(l.quantity, l.unitPrice, l.discount), l.taxRate))));
  if (doc.totalAmount <= 0) errors.push('Total amount is required.');
  const expected = round2(dec(doc.subtotal).minus(doc.discountAmount).plus(doc.taxAmount).plus(doc.freightAmount).plus(doc.otherCharges));
  if (doc.totalAmount > 0 && !within(expected, doc.totalAmount, tolerance(n))) {
    const msg = `Totals do not add up: subtotal ${doc.subtotal.toFixed(2)} - discount ${doc.discountAmount.toFixed(2)} + tax ${doc.taxAmount.toFixed(2)} + freight ${doc.freightAmount.toFixed(2)} + other ${doc.otherCharges.toFixed(2)} = ${expected.toFixed(2)}, but the total is ${doc.totalAmount.toFixed(2)} (difference ${round2(dec(doc.totalAmount).minus(expected)).toFixed(2)}).`;
    errors.push(msg);
    discrepancies.push({ scope: 'document', field: 'totalAmount', expected, actual: doc.totalAmount, message: msg });
  }
  // What the ERP will actually record (from the lines) against what the document printed.
  const plan = destination === 'PURCHASE_BILL' ? planPurchase(doc) : null;
  const erpTotal = plan ? plan.grandTotal : round2(dec(lineNetSum).minus(doc.discountAmount).plus(lineTaxSum).plus(doc.freightAmount).plus(doc.otherCharges));
  if (plan?.suggestedTaxRate !== null && plan?.suggestedTaxRate !== undefined && !plan.reconciles) {
    const msg = `The document charges tax of ${doc.taxAmount.toFixed(2)} but no line has a tax %. A rate of ${plan.suggestedTaxRate}% on the lines reproduces it: apply it if that is the supplier's rate.`;
    errors.push(msg);
    discrepancies.push({ scope: 'document', field: 'taxRate', expected: doc.taxAmount, actual: 0, message: msg, suggestion: { type: 'APPLY_TAX_RATE', rate: plan.suggestedTaxRate } });
  } else if (plan && n && doc.totalAmount > 0 && !within(erpTotal, doc.totalAmount, tolerance(n))) {
    const msg = `The lines add up to ${lineNetSum.toFixed(2)} (+ tax ${(plan ? plan.taxAmount : lineTaxSum).toFixed(2)}), which gives ${erpTotal.toFixed(2)}, but the document total is ${doc.totalAmount.toFixed(2)}. Check quantities, unit prices, discounts and tax on the lines${lineIssues.length ? ` (see: ${lineIssues[0]})` : ''}.`;
    if (!errors.some((e) => e.startsWith('Totals do not add up'))) errors.push(msg); else warnings.push(msg);
    discrepancies.push({ scope: 'document', field: 'lines', expected: erpTotal, actual: doc.totalAmount, message: msg });
  } else if (lineIssues.length) {
    // Sales documents are priced by the ERP itself (its tax and discount rules): the dry run in previewConversion is the judge of the total.
    warnings.push(...lineIssues.map((m) => `${m} The ERP will use quantity x price.`));
  }
  if (plan?.notes.length) warnings.push(...plan.notes);
  if (n && doc.subtotal > 0) {
    const gross = sum2(doc.lineItems.map((l) => dec(l.quantity).times(l.unitPrice).toNumber()));
    const readings = [gross, lineNetSum, round2(dec(lineNetSum).plus(lineTaxSum)), round2(dec(gross).plus(lineTaxSum))];
    if (readings.every((x) => !within(x, doc.subtotal, tolerance(n)))) {
      const msg = `Line items add up to ${lineNetSum.toFixed(2)} but the subtotal is ${doc.subtotal.toFixed(2)}.`;
      errors.push(msg);
      discrepancies.push({ scope: 'document', field: 'subtotal', expected: lineNetSum, actual: doc.subtotal, message: msg });
    }
  }
  if (doc.taxAmount > 0 && !doc.vatNumber.trim()) warnings.push('VAT/TRN number is missing although VAT is charged.');
  if (doc.otherCharges > 0 && ['TAX_INVOICE', 'QUOTATION', 'PROFORMA'].includes(destination)) {
    warnings.push('Other charges cannot be recorded separately on this document; they will be added to Freight.');
  }
  return { errors, warnings, discrepancies };
}
