/**
 * Server-side client for the external OCR microservice (ocr-service/, FastAPI + PaddleOCR).
 *
 * This is the ONLY place that knows the OCR wire format. To swap the OCR engine, point
 * OCR_API_URL at another service that returns the same contract (or adapt `toExtractedData`).
 * Never import this from client components: OCR_API_URL / OCR_API_KEY must stay on the server.
 */
import 'server-only';
import type { ExtractedDocumentData, ExtractedLineItem } from './ocr-types';

export class OcrError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

const TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 130_000);

function config() {
  const url = (process.env.OCR_API_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.OCR_API_KEY || '').trim();
  if (!url || !key) {
    throw new OcrError(503, 'not_configured', 'Document reading (OCR) is not configured. Ask an administrator to set OCR_API_URL and OCR_API_KEY.');
  }
  return { url, key };
}

/** Wire contract returned by POST /ocr (see ocr-service/app/main.py). */
export interface OcrContractResponse {
  success: boolean;
  document_type: 'invoice' | 'proforma' | 'purchase_order' | 'other';
  confidence: number;
  engine?: string;
  page_count?: number;
  is_scanned?: boolean;
  review_fields?: string[];
  field_confidence?: Record<string, number>;
  warnings?: string[];
  pages?: { page: number; source: string; line_count: number }[];
  data: Record<string, any> & { line_items: any[] };
}

const FRIENDLY: Record<string, string> = {
  file_too_large: 'The file is too large for document reading.',
  unsupported_type: 'This file type is not supported. Upload a PDF, PNG or JPG.',
  empty_file: 'The uploaded file is empty.',
  unreadable_file: 'The file could not be opened. It may be corrupt or password protected.',
  empty_result: 'No text could be read from this document. Try a clearer scan.',
  timeout: 'Reading the document took too long. Try a smaller or clearer file.',
  ocr_failed: 'The OCR engine could not process this document.',
  unauthorized: 'The ERP is not authorised to use the OCR service. Contact an administrator.',
};

export async function runOcr(file: Buffer, fileName: string): Promise<OcrContractResponse> {
  const { url, key } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), fileName || 'document');
    res = await fetch(`${url}/ocr`, { method: 'POST', headers: { 'X-API-Key': key }, body: form, signal: ctrl.signal, cache: 'no-store' });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new OcrError(504, 'timeout', FRIENDLY.timeout);
    throw new OcrError(503, 'unavailable', 'The OCR service is unavailable right now. Please try again shortly.');
  } finally {
    clearTimeout(timer);
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new OcrError(502, 'bad_response', res.ok ? 'The OCR service returned an unreadable response.' : `The OCR service failed (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const code: string = body?.error?.code || 'ocr_failed';
    // Map service statuses to ERP-facing ones; a 401 from the service is our misconfiguration, not the user's.
    const status = res.status === 401 ? 502 : res.status >= 500 && res.status !== 504 ? 502 : res.status;
    throw new OcrError(status, code, FRIENDLY[code] || body?.error?.message || 'The OCR service could not process this document.');
  }
  if (!body?.success || !body?.data || !Array.isArray(body.data.line_items)) {
    throw new OcrError(502, 'bad_response', 'The OCR service returned an unexpected response.');
  }
  return body as OcrContractResponse;
}

export async function checkOcrHealth(): Promise<{ configured: boolean; available: boolean; detail: string }> {
  const url = (process.env.OCR_API_URL || '').trim().replace(/\/+$/, '');
  if (!url || !process.env.OCR_API_KEY) return { configured: false, available: false, detail: 'OCR_API_URL / OCR_API_KEY not set' };
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { configured: true, available: true, detail: `${j.engine || 'OCR'} service online` } : { configured: true, available: false, detail: `Service responded ${r.status}` };
  } catch {
    return { configured: true, available: false, detail: 'Service unreachable' };
  }
}

const FIELD_MAP: Record<string, string> = {
  document_type: 'documentType', invoice_number: 'invoiceNumber', invoice_date: 'invoiceDate', due_date: 'dueDate',
  customer_name: 'customerName', supplier_name: 'supplierName', vat_number: 'vatNumber', currency: 'currency',
  subtotal: 'subtotal', discount: 'discountAmount', tax: 'taxAmount', freight: 'shippingCharges',
  other_charges: 'otherCharges', total: 'grandTotal', line_items: 'lineItems', payment_terms: 'paymentTerms',
};
const camel = (f: string) => FIELD_MAP[f] || f;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Adapts the OCR contract to the ERP's review-screen model. Contains no business rules. */
export function toExtractedData(r: OcrContractResponse): ExtractedDocumentData {
  const d = r.data;
  const type = { invoice: 'TAX_INVOICE', proforma: 'PROFORMA', purchase_order: 'PURCHASE_INVOICE', other: 'OTHER' }[r.document_type] as ExtractedDocumentData['documentType'] || 'OTHER';
  const stamp = Date.now();
  const lineItems: ExtractedLineItem[] = d.line_items.map((it: any, i: number) => ({
    id: `item-${i + 1}-${stamp}`,
    description: String(it.description ?? ''),
    productCode: String(it.sku ?? ''),
    sku: String(it.sku ?? ''),
    quantity: num(it.quantity),
    unitPrice: num(it.unit_price),
    discount: num(it.discount),
    taxAmount: num(it.tax),
    amount: num(it.total),
  }));
  const customer = String(d.customer_name ?? '');
  return {
    documentType: type,
    invoiceNumber: String(d.invoice_number ?? ''),
    proformaNumber: type === 'PROFORMA' ? String(d.invoice_number ?? '') : undefined,
    customerName: customer,
    companyName: customer,
    supplierName: String(d.supplier_name ?? ''),
    email: String(d.email ?? ''),
    phone: String(d.phone ?? ''),
    billingAddress: String(d.billing_address ?? ''),
    shippingAddress: String(d.shipping_address ?? ''),
    invoiceDate: String(d.invoice_date ?? ''),
    dueDate: String(d.due_date ?? ''),
    currency: String(d.currency ?? ''),
    paymentTerms: String(d.payment_terms ?? ''),
    subtotal: num(d.subtotal),
    taxAmount: num(d.tax),
    discountAmount: num(d.discount),
    shippingCharges: num(d.freight),
    otherCharges: num(d.other_charges),
    grandTotal: num(d.total),
    lineItems,
    rawConfidence: r.confidence,
    isScannedOcr: Boolean(r.is_scanned),
    pageCount: r.page_count,
    reviewFields: (r.review_fields || []).map(camel),
    fieldConfidence: Object.fromEntries(Object.entries(r.field_confidence || {}).map(([k, v]) => [camel(k), v])),
    warnings: r.warnings || [],
    ocrEngine: r.engine || 'OCR',
  };
}
