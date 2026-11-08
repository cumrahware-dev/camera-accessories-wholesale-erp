/**
 * The categories a stored document can have - the single list the upload screen, the upload API, the Documents hub and
 * the delete permission rule all read, so they cannot drift apart again (the upload screen once offered categories the
 * database rejected). `shipment` marks the ones that belong to a shipment: people who manage shipments may delete those.
 * Browser-safe.
 */
export const DOCUMENT_CATEGORIES = [
  { value: 'AIRWAY_BILL', label: 'Airway Bill (AWB)', shipment: true },
  { value: 'PACKING_LIST', label: 'Packing List', shipment: true },
  { value: 'DELIVERY_CHALLAN', label: 'Delivery Challan', shipment: true },
  { value: 'COMMERCIAL_INVOICE', label: 'Commercial Invoice', shipment: true },
  { value: 'SHIPPING_DOCUMENT', label: 'Shipping Document', shipment: true },
  { value: 'CUSTOMS_DOC', label: 'Customs / Export Doc', shipment: true },
  { value: 'PACKING_PHOTO', label: 'Packing Photo', shipment: true },
  { value: 'INSPECTION_REPORT', label: 'Inspection Report', shipment: false },
  { value: 'TAX_INVOICE', label: 'Tax Invoice', shipment: false },
  { value: 'PROFORMA', label: 'Proforma Invoice', shipment: false },
  { value: 'OTHER', label: 'Other Business Document', shipment: false },
] as const;

export type DocumentCategoryValue = (typeof DOCUMENT_CATEGORIES)[number]['value'];
export const DOCUMENT_CATEGORY_VALUES: string[] = DOCUMENT_CATEGORIES.map((c) => c.value);
export const SHIPMENT_CATEGORY_VALUES: string[] = DOCUMENT_CATEGORIES.filter((c) => c.shipment).map((c) => c.value);
export const categoryLabel = (v: string | null | undefined) => DOCUMENT_CATEGORIES.find((c) => c.value === v)?.label || String(v || 'Document');
export const isShipmentCategory = (v: string | null | undefined) => SHIPMENT_CATEGORY_VALUES.includes(String(v));
