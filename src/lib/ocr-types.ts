/**
 * Shared types for OCR-extracted document data (OCR pipeline).
 */

export interface ExtractedLineItem {
  id: string;
  description: string;
  productCode?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  amount: number;
}

export interface ExtractedDocumentData {
  documentType: 'PROFORMA' | 'TAX_INVOICE' | 'PURCHASE_INVOICE' | 'OTHER';
  invoiceNumber: string;
  proformaNumber?: string;
  customerName: string;
  supplierName?: string;
  companyName: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency: string;
  paymentTerms?: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  shippingCharges: number;
  otherCharges: number;
  grandTotal: number;
  lineItems: ExtractedLineItem[];
  rawConfidence?: number;
  isScannedOcr?: boolean;
  pageCount?: number;
  notes?: string;
  /** Fields the reviewer must check (empty, low OCR confidence, or failed arithmetic). */
  reviewFields?: string[];
  fieldConfidence?: Record<string, number>;
  warnings?: string[];
  ocrEngine?: string;
}
