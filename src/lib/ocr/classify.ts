/** Turns the OCR engine's raw document-type guess into an ERP document type. Pure functions. */
import type { OcrDocType } from './doc-types';
import { normalizeName, similarity } from './matching-utils';

export interface Classification { direction: 'sales' | 'purchase' | 'unknown'; type: OcrDocType; confidence: number; needsReview: boolean; reason: string }

/**
 * The engine only sees the printed title ("Invoice", "Tax Invoice", ...). Whether an invoice is a
 * sale or a purchase depends on which side we are: if our own company is the issuer it is a sale,
 * if we are the addressee it is a purchase. When that cannot be told, the user must choose.
 */
export function classify(engineType: string, typeConfidence: number, supplierName: string, customerName: string, ourNames: string[]): Classification {
  const isUs = (n: string) => !!n && ourNames.some((o) => similarity(n, o) >= 0.6 || (normalizeName(o) && normalizeName(n).includes(normalizeName(o))));
  const direction: 'sales' | 'purchase' | 'unknown' = isUs(supplierName) && !isUs(customerName) ? 'sales' : isUs(customerName) && !isUs(supplierName) ? 'purchase' : 'unknown';

  switch (engineType) {
    case 'tax_invoice':
    case 'invoice': {
      const generic = engineType === 'invoice';
      if (direction === 'purchase') return { direction, type: 'PURCHASE_INVOICE', confidence: typeConfidence * 0.95, needsReview: false, reason: 'Addressed to your company, so treated as a purchase.' };
      if (direction === 'sales') return { direction, type: generic ? 'SALES_INVOICE' : 'TAX_INVOICE', confidence: typeConfidence, needsReview: false, reason: 'Issued by your company, so treated as a sale.' };
      return { direction, type: generic ? 'SALES_INVOICE' : 'TAX_INVOICE', confidence: typeConfidence * 0.8, needsReview: true, reason: 'Could not tell whether your company is the seller or the buyer - confirm the type.' };
    }
    case 'quotation': return { direction, type: 'QUOTATION', confidence: typeConfidence, needsReview: false, reason: 'Title reads Quotation.' };
    case 'proforma_invoice': return { direction, type: 'PROFORMA_INVOICE', confidence: typeConfidence, needsReview: false, reason: 'Title reads Proforma.' };
    case 'purchase_bill': return { direction, type: 'PURCHASE_BILL', confidence: typeConfidence, needsReview: false, reason: 'Title reads Bill.' };
    case 'purchase_invoice': return { direction, type: 'PURCHASE_INVOICE', confidence: typeConfidence, needsReview: false, reason: 'Title reads Purchase Invoice.' };
    case 'credit_note': return { direction, type: 'CREDIT_NOTE', confidence: typeConfidence, needsReview: false, reason: 'Title reads Credit Note.' };
    case 'debit_note': return { direction, type: 'DEBIT_NOTE', confidence: typeConfidence, needsReview: false, reason: 'Title reads Debit Note.' };
    case 'delivery_note': return { direction, type: 'DELIVERY_NOTE', confidence: typeConfidence, needsReview: false, reason: 'Title reads Delivery Note.' };
    default: return { direction, type: 'OTHER', confidence: Math.min(typeConfidence, 0.3), needsReview: true, reason: 'No recognisable document title.' };
  }
}
