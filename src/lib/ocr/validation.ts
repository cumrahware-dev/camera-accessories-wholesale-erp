/** Pre-conversion validation. Pure: works on plain data, no database access. */
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
export interface ValidationResult { errors: string[]; warnings: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function validateForConversion(doc: ValidatableDoc, destination: DestinationKey, companyCurrency: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dest = DESTINATIONS[destination];
  const party = partyFor(doc.documentType);

  if (!dest.available) errors.push(`${dest.label} cannot be created: ${dest.note}`);
  if (!doc.documentNumber.trim()) errors.push('Document number is required.');

  const date = doc.documentDate ? new Date(doc.documentDate) : null;
  if (!date || isNaN(date.getTime())) errors.push('Document date is required.');
  else if (date.getTime() > Date.now() + 86400000) warnings.push('Document date is in the future.');

  if (destination === 'PURCHASE_BILL') {
    if (!doc.matchedSupplierId) errors.push('Supplier is required before converting to Purchase Bill. Select an existing supplier or create one.');
  } else if (party === 'customer' && !doc.matchedCustomerId) {
    errors.push(`Customer is required before converting to ${dest.label}. Select an existing customer or create one.`);
  } else if (party === 'supplier' && !doc.matchedSupplierId) {
    errors.push(`Supplier is required before converting to ${dest.label}. Select an existing supplier or create one.`);
  }

  if (!/^[A-Za-z]{3}$/.test(doc.currency.trim())) errors.push('Currency is required (3-letter code, e.g. USD).');
  else if (destination !== 'PURCHASE_BILL' && companyCurrency && doc.currency.trim().toUpperCase() !== companyCurrency.toUpperCase()) {
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

  // Header arithmetic. The ERP records its own computed totals, so a document that does not add up
  // is almost always an OCR misread and must be corrected first.
  const lineNet = r2(doc.lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  if (doc.totalAmount <= 0) errors.push('Total amount is required.');
  const expected = r2(doc.subtotal - doc.discountAmount + doc.taxAmount + doc.freightAmount + doc.otherCharges);
  if (doc.totalAmount > 0 && Math.abs(expected - doc.totalAmount) > 0.05) {
    errors.push(`Totals do not add up: subtotal - discount + tax + freight + other = ${expected.toFixed(2)}, but total is ${doc.totalAmount.toFixed(2)}.`);
  }
  const lineDisc = r2(doc.lineItems.reduce((s, l) => s + l.discount, 0));
  const lineTax = r2(doc.lineItems.reduce((s, l) => s + l.taxAmount, 0));
  const readings = [lineNet, r2(lineNet - lineDisc), r2(lineNet - lineTax), r2(lineNet - lineDisc + lineTax)];
  if (doc.lineItems.length && doc.subtotal > 0 && readings.every((x) => Math.abs(x - doc.subtotal) > 0.05)) {
    errors.push(`Line items add up to ${lineNet.toFixed(2)} but the subtotal is ${doc.subtotal.toFixed(2)}.`);
  }
  if (doc.taxAmount > 0 && !doc.vatNumber.trim()) warnings.push('VAT/TRN number is missing although VAT is charged.');
  if (doc.otherCharges > 0 && ['TAX_INVOICE', 'QUOTATION', 'PROFORMA'].includes(destination)) {
    warnings.push('Other charges cannot be recorded separately on this document; they will be added to Freight.');
  }
  if (doc.otherCharges > 0 && destination === 'PURCHASE_BILL') {
    warnings.push('Other charges and freight are not recorded separately on purchase invoices; ensure line unit costs reflect landed cost.');
  }
  return { errors, warnings };
}
