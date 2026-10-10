/**
 * Review indicators. Each one answers "can I rely on this?" from what was matched and validated, not from the OCR
 * engine's own confidence (a confidently-read wrong number is still wrong).
 *   ok      nothing to do        review  look at it (yellow, not an error)        missing  needed and absent / invalid (blocks conversion)
 */
import { OcrDocType, partyFor } from './doc-types';

export type Level = 'ok' | 'review' | 'missing';
export interface Indicator { key: string; label: string; level: Level; detail: string; field?: string; target: 'header' | 'lines' | 'totals' }

interface Line { description: string; sku: string; quantity: number; unitPrice: number; total: number; taxRate: number; matchedProductId: string | null; lowConfidence?: boolean; suggestions?: unknown[] }
interface Check { errors?: string[]; discrepancies?: { scope: string; line?: number; field: string; message: string }[] }

export function reviewIndicators(doc: any, check: Check | undefined): Indicator[] {
  const review = new Set<string>(doc.reviewFields ?? []);
  const confirmed = doc.processingStatus === 'CONFIRMED';
  const lines: Line[] = doc.lineItems ?? [];
  const party = partyFor(doc.documentType as OcrDocType);
  const disc = check?.discrepancies ?? [];
  const lvl = (missing: boolean, flagged: boolean): Level => (missing ? 'missing' : flagged && !confirmed ? 'review' : 'ok');
  const count = (n: number, what: string) => `${n} line${n === 1 ? '' : 's'} ${what}`;
  const out: Indicator[] = [];

  out.push({ key: 'type', label: 'Document type', level: lvl(false, review.has('documentType') || (doc.typeConfidence ?? 1) < 0.7), detail: `Detected as ${String(doc.documentType).replace(/_/g, ' ').toLowerCase()} (${Math.round((doc.typeConfidence ?? 0) * 100)}%)`, field: 'documentType', target: 'header' });

  const matchedParty = party === 'supplier' ? doc.matchedSupplierId : doc.matchedCustomerId;
  const partyName = party === 'supplier' ? doc.supplierName : doc.customerName;
  out.push({ key: 'party', label: party === 'supplier' ? 'Supplier' : 'Customer', level: matchedParty ? (review.has(party === 'supplier' ? 'supplierName' : 'customerName') && !confirmed ? 'review' : 'ok') : 'missing', detail: matchedParty ? 'Matched to an existing record' : partyName ? 'Not matched yet: choose an existing record' : 'Not found on the document', field: party === 'supplier' ? 'supplierName' : 'customerName', target: 'header' });

  out.push({ key: 'number', label: 'Invoice number', level: lvl(!String(doc.documentNumber ?? '').trim(), review.has('documentNumber')), detail: doc.documentNumber || 'Not found', field: 'documentNumber', target: 'header' });
  out.push({ key: 'date', label: 'Date', level: lvl(!doc.documentDate, review.has('documentDate')), detail: doc.documentDate ? String(doc.documentDate).slice(0, 10) : 'Not found', field: 'documentDate', target: 'header' });

  const unmatched = lines.filter((l) => !l.matchedProductId);
  const needsProduct = ['TAX_INVOICE', 'SALES_INVOICE', 'QUOTATION', 'PROFORMA_INVOICE', 'PURCHASE_BILL', 'PURCHASE_INVOICE'].includes(doc.documentType);
  out.push({ key: 'products', label: 'SKU / product match', level: !lines.length ? 'missing' : unmatched.length ? (needsProduct ? 'missing' : 'review') : 'ok', detail: !lines.length ? 'No line items' : unmatched.length ? `${count(unmatched.length, 'not matched to a catalogue product')}${unmatched.some((l) => (l.suggestions?.length ?? 0) > 0) ? ' (suggestions available)' : ''}` : 'All lines matched', target: 'lines' });

  const noDesc = lines.filter((l) => !String(l.description).trim()).length;
  const lowDesc = lines.filter((l) => l.lowConfidence).length;
  out.push({ key: 'description', label: 'Description', level: noDesc ? 'missing' : lowDesc && !confirmed ? 'review' : 'ok', detail: noDesc ? count(noDesc, 'without a description') : lowDesc ? count(lowDesc, 'read with low confidence') : 'Kept as printed by the supplier', target: 'lines' });

  const badQty = lines.filter((l) => !(l.quantity > 0)).length;
  out.push({ key: 'qty', label: 'Quantity', level: badQty ? 'missing' : lvl(false, lowDesc > 0), detail: badQty ? count(badQty, 'with no valid quantity') : 'Read for every line', target: 'lines' });

  out.push({ key: 'price', label: 'Unit price', level: lines.some((l) => !(l.unitPrice >= 0)) ? 'missing' : 'ok', detail: 'Read for every line', target: 'lines' });

  const lineDisc = disc.filter((d) => d.scope === 'line');
  out.push({ key: 'linetotal', label: 'Line totals', level: lineDisc.length ? 'review' : 'ok', detail: lineDisc.length ? lineDisc[0].message : 'Quantity x price - discount agrees with every line', target: 'lines' });

  const taxFlag = review.has('taxAmount') || (doc.taxAmount > 0 && lines.length > 0 && lines.every((l) => !(l.taxRate > 0)));
  out.push({ key: 'tax', label: 'Tax / VAT', level: lvl(false, taxFlag), detail: doc.taxAmount > 0 ? (lines.every((l) => !(l.taxRate > 0)) ? `Document shows tax ${Number(doc.taxAmount).toFixed(2)} but no line has a tax %` : `Tax ${Number(doc.taxAmount).toFixed(2)} as printed`) : 'No tax charged', field: 'taxAmount', target: 'totals' });

  const docDisc = disc.filter((d) => d.scope === 'document');
  out.push({ key: 'total', label: 'Grand total', level: !(doc.totalAmount > 0) ? 'missing' : docDisc.length ? 'review' : lvl(false, review.has('totalAmount')), detail: docDisc.length ? docDisc[0].message : !(doc.totalAmount > 0) ? 'Not found' : 'Reconciles with the lines', field: 'totalAmount', target: 'totals' });
  return out;
}
