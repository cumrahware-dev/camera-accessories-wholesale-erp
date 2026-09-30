/**
 * Shared (client + server) definitions for the OCR intake module.
 * Keep free of server-only imports.
 */
export type OcrDocType =
  | 'SALES_INVOICE' | 'TAX_INVOICE' | 'QUOTATION' | 'PROFORMA_INVOICE' | 'PURCHASE_BILL'
  | 'PURCHASE_INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'DELIVERY_NOTE' | 'OTHER';

export const DOC_TYPE_OPTIONS: { value: OcrDocType; label: string }[] = [
  { value: 'SALES_INVOICE', label: 'Sales Invoice' },
  { value: 'TAX_INVOICE', label: 'Tax Invoice' },
  { value: 'QUOTATION', label: 'Quotation' },
  { value: 'PROFORMA_INVOICE', label: 'Proforma Invoice' },
  { value: 'PURCHASE_BILL', label: 'Purchase Bill' },
  { value: 'PURCHASE_INVOICE', label: 'Purchase Invoice' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' },
  { value: 'DEBIT_NOTE', label: 'Debit Note' },
  { value: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { value: 'OTHER', label: 'Other / Unknown' },
];
export const docTypeLabel = (t: string) => DOC_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;

export type Party = 'customer' | 'supplier' | 'none';
/** Which ERP record the counterparty of this document type must be matched to. */
export function partyFor(t: OcrDocType): Party {
  if (['SALES_INVOICE', 'TAX_INVOICE', 'QUOTATION', 'PROFORMA_INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(t)) return 'customer';
  if (t === 'PURCHASE_BILL' || t === 'PURCHASE_INVOICE') return 'supplier';
  return 'none';
}

export type DestinationKey = 'TAX_INVOICE' | 'QUOTATION' | 'PROFORMA' | 'PURCHASE_BILL' | 'CREDIT_NOTE' | 'DEBIT_NOTE';

export interface Destination {
  key: DestinationKey;
  label: string;
  /** False when the ERP has no module that can receive this document yet. */
  available: boolean;
  note: string;
}

const NOT_BUILT = 'This ERP has no such module yet, so the document can be stored and reviewed but not converted.';

export const DESTINATIONS: Record<DestinationKey, Destination> = {
  TAX_INVOICE: { key: 'TAX_INVOICE', label: 'Tax Invoice', available: true, note: 'Created through the standard workflow: Proforma → Confirmed → Tax Invoice. It enters the Depot queue, notifies the Depot team and updates the customer balance, exactly like any other invoice.' },
  QUOTATION: { key: 'QUOTATION', label: 'Quotation', available: true, note: 'Saved as a draft Proforma, which is the ERP’s quotation record.' },
  PROFORMA: { key: 'PROFORMA', label: 'Proforma Invoice', available: true, note: 'Saved as a draft Proforma.' },
  PURCHASE_BILL: { key: 'PURCHASE_BILL', label: 'Purchase Bill', available: false, note: NOT_BUILT },
  CREDIT_NOTE: { key: 'CREDIT_NOTE', label: 'Credit Note', available: false, note: NOT_BUILT },
  DEBIT_NOTE: { key: 'DEBIT_NOTE', label: 'Debit Note', available: false, note: NOT_BUILT },
};

/** Destinations offered for each detected/selected type. */
export function destinationsFor(t: OcrDocType): Destination[] {
  switch (t) {
    case 'SALES_INVOICE':
    case 'TAX_INVOICE': return [DESTINATIONS.TAX_INVOICE];
    case 'QUOTATION': return [DESTINATIONS.QUOTATION];
    case 'PROFORMA_INVOICE': return [DESTINATIONS.PROFORMA];
    case 'PURCHASE_BILL':
    case 'PURCHASE_INVOICE': return [DESTINATIONS.PURCHASE_BILL];
    case 'CREDIT_NOTE': return [DESTINATIONS.CREDIT_NOTE];
    case 'DEBIT_NOTE': return [DESTINATIONS.DEBIT_NOTE];
    default: return [];
  }
}

export const PROCESSING_STATUS_LABEL: Record<string, string> = {
  UPLOADED: 'Uploaded', PROCESSING: 'Processing', PROCESSED: 'Processed',
  NEEDS_REVIEW: 'Needs Review', CONFIRMED: 'Confirmed', FAILED: 'Failed',
};

/** Single user-facing status combining processing and conversion state. */
export function displayStatus(processing: string, conversion: string): { key: string; label: string } {
  if (conversion === 'CONVERTED') return { key: 'CONVERTED', label: 'Converted' };
  if (conversion === 'CONVERTING') return { key: 'PROCESSING', label: 'Converting' };
  return { key: processing, label: PROCESSING_STATUS_LABEL[processing] ?? processing };
}
