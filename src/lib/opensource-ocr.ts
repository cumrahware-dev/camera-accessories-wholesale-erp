/**
 * Open-source OCR + document extraction pipeline (pdf-parse + tesseract.js).
 *
 * This is the no-cost fallback/augmentation to Azure Document Intelligence:
 * digital PDFs are read directly via their embedded text layer (fast, exact),
 * and images or scanned/image-only PDFs are rasterized and OCR'd with
 * tesseract.js. Field extraction from the resulting plain text is heuristic
 * (regex-based), not a trained ML model, so it will be less precise than
 * Azure's prebuilt-invoice model — the caller always routes the result
 * through the same review & edit screen before anything is saved.
 */
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { createWorker, type Worker } from 'tesseract.js';
import type { ExtractedDocumentData, ExtractedLineItem } from './azure-document-intelligence';

// The English trained-data file is bundled in the repo (assets/tesseract-ocr)
// rather than fetched from the jsdelivr CDN on first use — the CDN is not
// reachable from every deployment/sandbox network, and re-downloading a
// ~3MB file on every cold start is slow and unreliable in production.
const TESSERACT_LANG_PATH = path.join(process.cwd(), 'assets', 'tesseract-ocr');

let workerPromise: Promise<Worker> | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', undefined, {
      langPath: TESSERACT_LANG_PATH,
      gzip: true,
      cacheMethod: 'none',
    });
  }
  return workerPromise;
}

async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(buffer);
  return data.text || '';
}

/**
 * Extracts raw text from a PDF or image buffer. For PDFs, prefers the
 * embedded text layer; only rasterizes + OCRs pages when there's no usable
 * text layer (i.e. a scanned/image-only PDF).
 */
async function extractRawText(
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ text: string; isScannedOcr: boolean; pageCount: number }> {
  if (mimeType.startsWith('image/')) {
    const text = await ocrImageBuffer(fileBuffer);
    return { text, isScannedOcr: true, pageCount: 1 };
  }

  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: fileBuffer });
    try {
      const textResult = await parser.getText();
      const combinedText = (textResult.text || '').trim();

      // A real digital PDF will have a substantial text layer. Anything this
      // short almost always means the PDF is just scanned page images with
      // no embedded text, so fall through to OCR instead.
      if (combinedText.length > 40) {
        return { text: combinedText, isScannedOcr: false, pageCount: textResult.pages?.length || 1 };
      }

      const screenshots = await parser.getScreenshot({ scale: 2, imageBuffer: true });
      let ocrText = '';
      for (const page of screenshots.pages || []) {
        if (page.data) {
          ocrText += `${await ocrImageBuffer(Buffer.from(page.data))}\n`;
        }
      }
      return { text: ocrText, isScannedOcr: true, pageCount: screenshots.pages?.length || 1 };
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`Unsupported file type for open-source OCR: ${mimeType}`);
}

// --- Heuristic field extraction from plain OCR/text-layer text ---

function findFirstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function parseAmount(raw?: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  // Try DD/MM/YYYY or MM/DD/YYYY as a last resort
  const parts = raw.split(/[\/\-.]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map((p) => parseInt(p, 10));
    const year = c > 31 ? c : a > 31 ? a : c;
    if (year && year > 1900) {
      const guess = new Date(year < 100 ? 2000 + year : year, (b || 1) - 1, a || 1);
      if (!Number.isNaN(guess.getTime())) return guess.toISOString().split('T')[0];
    }
  }
  return undefined;
}

// Lines that are clearly document metadata/totals/pagination rather than a
// product line — these are already handled by the dedicated field regexes
// above, so excluding them here avoids double-counting them as fake items.
const NON_ITEM_LINE =
  /\b(invoice|proforma|quotation|date|due|bill\s*to|customer|sub\s*-?\s*total|grand\s*total|amount\s*due|vat|tax|shipping|freight|payment\s*terms?|page\s*\d)\b|--\s*\d+\s*of\s*\d+\s*--/i;

/** Attempts to find "<description> ... <qty> ... <price> ... <amount>" style rows. */
function extractLineItems(lines: string[]): ExtractedLineItem[] {
  const items: ExtractedLineItem[] = [];
  // A line with 3+ numeric tokens where the last roughly equals qty*price is
  // treated as a line item row (common in tabular invoice text extraction).
  const numberToken = /-?\d[\d,]*\.?\d*/g;

  for (const line of lines) {
    if (NON_ITEM_LINE.test(line)) continue;

    const numbers = line.match(numberToken);
    if (!numbers || numbers.length < 2) continue;

    const trailing = numbers.slice(-3).map((n) => parseAmount(n));
    if (trailing.length < 2) continue;

    const description = line.replace(numberToken, '').replace(/\s{2,}/g, ' ').trim();
    if (description.length < 3) continue;

    let quantity = 1;
    let unitPrice = trailing[trailing.length - 2] ?? 0;
    let amount = trailing[trailing.length - 1] ?? 0;

    if (trailing.length === 3) {
      quantity = trailing[0] || 1;
      unitPrice = trailing[1] || 0;
      amount = trailing[2] || quantity * unitPrice;
    } else if (Math.abs(unitPrice * quantity - amount) > 0.5 && unitPrice > 0) {
      // Two numbers only — assume unitPrice and amount, back out quantity.
      quantity = amount > 0 && unitPrice > 0 ? Math.max(1, Math.round(amount / unitPrice)) : 1;
    }

    if (amount <= 0 && unitPrice > 0) amount = unitPrice * quantity;
    if (amount <= 0) continue;

    items.push({
      id: `item-${items.length + 1}-${Date.now()}`,
      description,
      sku: `SKU-${description.slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ITEM'}`,
      quantity,
      unitPrice: unitPrice || amount / quantity,
      taxRate: 5,
      amount,
    });

    if (items.length >= 25) break; // sanity cap
  }

  return items;
}

function parseInvoiceTextHeuristically(
  text: string,
  fileName?: string,
  isScannedOcr?: boolean,
  pageCount?: number
): ExtractedDocumentData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const invoiceNumber = findFirstMatch(text, [
    /(?:tax\s*invoice|invoice)\s*(?:no|number|#)?[\s:.-]*([A-Z0-9][A-Z0-9\-\/]{3,20})/i,
    /(?:proforma|quotation|pi)\s*(?:no|number|#)?[\s:.-]*([A-Z0-9][A-Z0-9\-\/]{3,20})/i,
  ]);

  const invoiceDateRaw = findFirstMatch(text, [
    /(?:invoice|issue)\s*date[\s:.-]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,4})/i,
    /date[\s:.-]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,4})/i,
  ]);

  const dueDateRaw = findFirstMatch(text, [
    /due\s*date[\s:.-]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,4})/i,
  ]);

  const grandTotalRaw = findFirstMatch(text, [
    /grand\s*total[\s:.-]*\$?\s*([\d,]+\.?\d*)/i,
    /total\s*amount\s*due[\s:.-]*\$?\s*([\d,]+\.?\d*)/i,
    /amount\s*due[\s:.-]*\$?\s*([\d,]+\.?\d*)/i,
    /\btotal\b[\s:.-]*\$?\s*([\d,]+\.?\d*)/i,
  ]);

  const subtotalRaw = findFirstMatch(text, [/sub\s*-?\s*total[\s:.-]*\$?\s*([\d,]+\.?\d*)/i]);
  const taxRaw = findFirstMatch(text, [/(?:vat|tax)\s*(?:\(\d+%\))?[\s:.-]*\$?\s*([\d,]+\.?\d*)/i]);
  const shippingRaw = findFirstMatch(text, [/(?:shipping|freight)\s*(?:charges?|cost)?[\s:.-]*\$?\s*([\d,]+\.?\d*)/i]);

  const customerName = findFirstMatch(text, [
    /(?:bill\s*to|customer|client)[\s:.-]*\n?([A-Za-z0-9][\w\s.,&'\-]{2,60})/i,
  ]) || lines.find((l) => l.length > 3 && !/invoice|proforma|date|total/i.test(l)) || 'Customer';

  const currencyMatch = text.match(/\b(USD|AED|EUR|GBP|INR|SGD)\b/i);
  const currency = (currencyMatch?.[1] || 'USD').toUpperCase();

  const grandTotal = parseAmount(grandTotalRaw);
  const subtotal = parseAmount(subtotalRaw) || grandTotal;
  const taxAmount = parseAmount(taxRaw);
  const shippingCharges = parseAmount(shippingRaw);

  const lowerName = (fileName || '').toLowerCase();
  let documentType: ExtractedDocumentData['documentType'] = 'PROFORMA';
  if (lowerName.includes('tax') || /tax\s*invoice/i.test(text.slice(0, 500))) {
    documentType = 'TAX_INVOICE';
  } else if (lowerName.includes('purchase') || lowerName.includes('po-')) {
    documentType = 'PURCHASE_INVOICE';
  }

  const lineItems = extractLineItems(lines);

  return {
    documentType,
    invoiceNumber: invoiceNumber || `DOC-${Date.now().toString().slice(-6)}`,
    proformaNumber: documentType === 'PROFORMA' ? invoiceNumber : undefined,
    customerName: customerName.split('\n')[0].trim(),
    companyName: customerName.split('\n')[0].trim(),
    supplierName: 'ARIB GLOBAL Wholesale',
    billingAddress: '',
    shippingAddress: '',
    invoiceDate: normalizeDate(invoiceDateRaw) || new Date().toISOString().split('T')[0],
    dueDate: normalizeDate(dueDateRaw) || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    currency,
    paymentTerms: 'NET 30 Days',
    subtotal,
    taxAmount,
    discountAmount: 0,
    shippingCharges,
    otherCharges: 0,
    grandTotal: grandTotal || subtotal + taxAmount + shippingCharges,
    lineItems:
      lineItems.length > 0
        ? lineItems
        : [
            {
              id: `item-1-${Date.now()}`,
              description: 'Review and add line items — none were confidently detected by OCR',
              sku: '',
              quantity: 1,
              unitPrice: grandTotal || 0,
              amount: grandTotal || 0,
              taxRate: 5,
            },
          ],
    pageCount: pageCount || 1,
    rawConfidence: lineItems.length > 0 ? 0.6 : 0.3,
    isScannedOcr: Boolean(isScannedOcr),
    ocrEngine: 'OPEN_SOURCE',
    notes:
      'Extracted with open-source OCR (pdf-parse / tesseract.js), not Azure Document Intelligence. Field detection is heuristic — please review every value carefully before saving.',
  };
}

export async function extractDocumentOpenSource(
  fileBuffer: Buffer,
  fileName?: string,
  mimeType?: string
): Promise<ExtractedDocumentData> {
  const resolvedMime = (mimeType || 'application/pdf').toLowerCase().split(';')[0].trim();
  const { text, isScannedOcr, pageCount } = await extractRawText(fileBuffer, resolvedMime);

  if (!text || text.trim().length < 5) {
    throw new Error(
      'Open-source OCR could not read any text from this document. Try a clearer scan or configure Azure Document Intelligence for higher-accuracy extraction.'
    );
  }

  return parseInvoiceTextHeuristically(text, fileName, isScannedOcr, pageCount);
}

/** Releases the shared tesseract.js worker. Call on graceful shutdown only — not per-request. */
export async function terminateOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}
