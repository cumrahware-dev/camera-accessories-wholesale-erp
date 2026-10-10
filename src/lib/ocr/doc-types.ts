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

export type DestinationKey = 'TAX_INVOICE' | 'QUOTATION' | 'PROFORMA' | 'PURCHASE_BILL' | 'SERVICE_INVOICE';

export interface Destination {
  key: DestinationKey;
  label: string;
  /** False when the ERP has no module that can receive this document yet. */
  available: boolean;
  note: string;
}

export const DESTINATIONS: Record<DestinationKey, Destination> = {
  TAX_INVOICE: { key: 'TAX_INVOICE', label: 'Tax Invoice', available: true, note: 'Created through the standard workflow: Proforma → Confirmed → Tax Invoice. It enters the Depot queue, notifies the Depot team and updates the customer balance, exactly like any other invoice.' },
  PROFORMA: { key: 'PROFORMA', label: 'Proforma Invoice', available: true, note: 'Saved as a draft Proforma.' },
  QUOTATION: { key: 'QUOTATION', label: 'Quotation', available: true, note: 'Saved as a draft Proforma, which is the ERP’s quotation record.' },
  PURCHASE_BILL: { key: 'PURCHASE_BILL', label: 'Purchase Bill', available: true, note: 'Saved as a draft Purchase Invoice in the Purchases module. Line items and stock quantities can be reviewed and edited before posting stock-in.' },
  SERVICE_INVOICE: { key: 'SERVICE_INVOICE', label: 'Service Invoice', available: true, note: 'Saved as a Service Invoice in the Service Invoices module for business services and non-inventory items.' },
};

/** Destinations offered for each detected/selected type. */
export function destinationsFor(t: OcrDocType): Destination[] {
  switch (t) {
    case 'PURCHASE_BILL':
    case 'PURCHASE_INVOICE':
      return [DESTINATIONS.PURCHASE_BILL, DESTINATIONS.TAX_INVOICE, DESTINATIONS.PROFORMA, DESTINATIONS.SERVICE_INVOICE, DESTINATIONS.QUOTATION];
    case 'CREDIT_NOTE':
    case 'DEBIT_NOTE':
      return [DESTINATIONS.PURCHASE_BILL, DESTINATIONS.SERVICE_INVOICE, DESTINATIONS.TAX_INVOICE, DESTINATIONS.PROFORMA, DESTINATIONS.QUOTATION];
    case 'QUOTATION':
      return [DESTINATIONS.QUOTATION, DESTINATIONS.PROFORMA, DESTINATIONS.TAX_INVOICE, DESTINATIONS.PURCHASE_BILL, DESTINATIONS.SERVICE_INVOICE];
    case 'PROFORMA_INVOICE':
      return [DESTINATIONS.PROFORMA, DESTINATIONS.TAX_INVOICE, DESTINATIONS.QUOTATION, DESTINATIONS.PURCHASE_BILL, DESTINATIONS.SERVICE_INVOICE];
    case 'SALES_INVOICE':
    case 'TAX_INVOICE':
      return [DESTINATIONS.TAX_INVOICE, DESTINATIONS.PROFORMA, DESTINATIONS.SERVICE_INVOICE, DESTINATIONS.QUOTATION, DESTINATIONS.PURCHASE_BILL];
    default:
      return [DESTINATIONS.TAX_INVOICE, DESTINATIONS.PROFORMA, DESTINATIONS.PURCHASE_BILL, DESTINATIONS.SERVICE_INVOICE, DESTINATIONS.QUOTATION];
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
