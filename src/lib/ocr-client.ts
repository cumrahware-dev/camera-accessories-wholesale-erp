/**
 * Server-side client for the external OCR microservice (ocr-service/, FastAPI + Tesseract).
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
  document_type: string;
  status?: string;
  text?: string;
  type_confidence?: number;
  confidence: number;
  engine?: string;
  page_count?: number;
  is_scanned?: boolean;
  fields?: Record<string, { value: unknown; confidence: number | null; page: number | null; level: string }>;
  metrics?: { processing_ms?: number; peak_rss_mb?: number };
  document?: { kind: string; pages: number; text_layer_pages: number; scanned_pages: number };
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
  too_many_pages: 'This document has too many pages for OCR. Split it and upload the relevant pages.',
  encrypted: 'This PDF is password protected. Remove the password and upload it again.',
  image_too_large: 'This image is too large to process. Upload a smaller scan (up to about 40 megapixels).',
  busy: 'The OCR service is busy with other documents. Please try again in a minute.',
  engine_unavailable: 'The OCR engine is not available on the server. Contact an administrator.',
  empty_document: 'This PDF has no pages.',
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
    const status = res.status === 401 ? 502 : res.status === 429 ? 503 : res.status >= 500 && res.status !== 504 ? 502 : res.status;
    throw new OcrError(status, code, FRIENDLY[code] || body?.error?.message || body?.message || 'The OCR service could not process this document.');
  }
  if (!body?.success || !body?.data || !Array.isArray(body.data.line_items) || typeof body.document_type !== 'string') {
    throw new OcrError(502, 'bad_response', body?.message || 'The OCR service returned an unexpected response.');
  }
  if (typeof body.text === 'string' && body.text.trim().length === 0) {
    throw new OcrError(422, 'empty_result', FRIENDLY.empty_result); // OCR produced no readable text: do not classify nothing
  }
  return body as OcrContractResponse;
}

export type OcrDisconnectReason =
  | 'OCR API URL missing'
  | 'OCR API key missing'
  | 'OCR service unavailable'
  | 'Authentication failed'
  | 'Health check failed'
  | 'Timeout'
  | 'Connected';

export interface OcrHealthResult {
  connected: boolean;
  statusText: 'Connected' | 'OCR Service Not Connected';
  reason: OcrDisconnectReason;
  detail: string;
  configured: boolean;
  available: boolean;
}

export async function checkOcrHealth(): Promise<OcrHealthResult> {
  const rawUrl = (process.env.OCR_API_URL || '').trim();
  const rawKey = (process.env.OCR_API_KEY || '').trim();

  if (!rawUrl) {
    return {
      connected: false,
      statusText: 'OCR Service Not Connected',
      reason: 'OCR API URL missing',
      detail: 'OCR_API_URL is not configured in server environment variables.',
      configured: false,
      available: false,
    };
  }

  if (!rawKey) {
    return {
      connected: false,
      statusText: 'OCR Service Not Connected',
      reason: 'OCR API key missing',
      detail: 'OCR_API_KEY is not configured in server environment variables.',
      configured: false,
      available: false,
    };
  }

  const url = rawUrl.replace(/\/+$/, '');

  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      headers: { 'X-API-Key': rawKey },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });

    const body = await res.json().catch(() => ({}));

    if (res.status === 401 || res.status === 403 || body?.status === 'unauthorized') {
      return {
        connected: false,
        statusText: 'OCR Service Not Connected',
        reason: 'Authentication failed',
        detail: 'The OCR service rejected the configured OCR_API_KEY (HTTP 401).',
        configured: true,
        available: false,
      };
    }

    if (res.status === 503 || body?.status === 'degraded') {
      return {
        connected: false,
        statusText: 'OCR Service Not Connected',
        reason: 'Health check failed',
        detail: `OCR service issue: ${body?.reason || body?.detail || 'OCR engine unavailable on server'} (HTTP 503)`,
        configured: true,
        available: false,
      };
    }

    if (!res.ok) {
      return {
        connected: false,
        statusText: 'OCR Service Not Connected',
        reason: 'Health check failed',
        detail: `OCR health check failed with HTTP status ${res.status}`,
        configured: true,
        available: false,
      };
    }

    return {
      connected: true,
      statusText: 'Connected',
      reason: 'Connected',
      detail: `${body.engine || 'OCR'} service online${body.version ? ` (v${body.version})` : ''}`,
      configured: true,
      available: true,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.toLowerCase().includes('timeout')) {
      return {
        connected: false,
        statusText: 'OCR Service Not Connected',
        reason: 'Timeout',
        detail: `Connection to OCR service timed out after 5s (${url})`,
        configured: true,
        available: false,
      };
    }

    return {
      connected: false,
      statusText: 'OCR Service Not Connected',
      reason: 'OCR service unavailable',
      detail: `OCR service unreachable at ${url}`,
      configured: true,
      available: false,
    };
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
  const type = ({ tax_invoice: 'TAX_INVOICE', invoice: 'TAX_INVOICE', proforma_invoice: 'PROFORMA', quotation: 'PROFORMA', purchase_bill: 'PURCHASE_INVOICE', purchase_invoice: 'PURCHASE_INVOICE' } as Record<string, ExtractedDocumentData['documentType']>)[r.document_type] || 'OTHER';
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

/** PNG of one PDF page from the OCR service (no OCR is run), so the review screen can draw field highlights on PDFs. */
export async function renderPdfPage(file: Buffer, page: number, dpi = 110): Promise<Buffer> {
  const { url, key } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), 'document.pdf');
    const res = await fetch(`${url}/render?page=${page}&dpi=${dpi}`, { method: 'POST', headers: { 'X-API-Key': key }, body: form, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new OcrError(res.status === 404 ? 404 : 502, 'render_failed', res.status === 404 ? 'Page not found.' : 'The page could not be rendered.');
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    if (e instanceof OcrError) throw e;
    throw new OcrError(503, 'unavailable', 'The OCR service is unavailable right now.');
  } finally {
    clearTimeout(timer);
  }
}
