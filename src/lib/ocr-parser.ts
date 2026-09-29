/**
 * Turns raw OCR lines into structured invoice data.
 *
 * Rules: never invent a value. Anything not found stays empty/0 and is listed
 * in `reviewFields` so the UI can force a manual check. Arithmetic
 * inconsistencies are reported in `warnings`, never silently "fixed".
 */
import type { OcrLine, OcrResult } from './paddle-ocr';
import type { ExtractedDocumentData, ExtractedLineItem } from './ocr-types';

const LOW_CONF = 0.85;

interface Row {
  text: string;
  conf: number;
  page: number;
}

/** Group OCR boxes into visual rows (same baseline), left to right. */
function toRows(result: OcrResult): Row[] {
  const rows: Row[] = [];
  for (const pg of result.pages) {
    const lines = [...pg.lines].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
    const groups: OcrLine[][] = [];
    for (const l of lines) {
      const cy = (l.y0 + l.y1) / 2;
      const g = groups[groups.length - 1];
      if (g) {
        const gy = g.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / g.length;
        const gh = g.reduce((s, x) => s + (x.y1 - x.y0), 0) / g.length;
        if (Math.abs(cy - gy) < Math.max(gh, l.y1 - l.y0) * 0.5) {
          g.push(l);
          continue;
        }
      }
      groups.push([l]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x0 - b.x0);
      rows.push({
        text: g.map((x) => x.text.trim()).join('  ').replace(/[ \t]+/g, (m) => (m.length > 1 ? '  ' : ' ')),
        conf: Math.min(...g.map((x) => x.conf)),
        page: pg.page,
      });
    }
  }
  return rows;
}

/** Parse "1,234.56", "1.234,56", "1 234,56", "$12" -> number, or null. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,\-\s]/g, '').trim().replace(/\s+/g, '');
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // "1,234" thousands vs "12,50" decimal
    s = /,\d{2}$/.test(s) && !/,\d{3}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const NUM = String.raw`-?\d[\d.,]*`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Returns ISO date + whether day/month order was ambiguous. */
export function parseDate(raw: string): { iso: string; ambiguous: boolean } | null {
  let m = raw.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const fmt = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  if (m) {
    const iso = fmt(+m[1], +m[2], +m[3]);
    return iso ? { iso, ambiguous: false } : null;
  }
  m = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const a = +m[1], b = +m[2];
    // Day-first is the convention for this business (UAE/India); flag if it could be month-first.
    const iso = a > 12 ? fmt(y, b, a) : fmt(y, b, a);
    return iso ? { iso, ambiguous: a <= 12 && b <= 12 && a !== b } : null;
  }
  m = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-,]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})\b/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const iso = mo ? fmt(+m[3], mo, +m[1]) : null;
    return iso ? { iso, ambiguous: false } : null;
  }
  m = raw.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const iso = mo ? fmt(+m[3], mo, +m[2]) : null;
    return iso ? { iso, ambiguous: false } : null;
  }
  return null;
}

const CURRENCY_CODES = ['USD', 'AED', 'INR', 'EUR', 'GBP', 'SAR', 'CNY', 'JPY', 'SGD', 'HKD', 'AUD', 'CAD', 'CHF', 'QAR', 'KWD', 'OMR', 'BHD'];
function detectCurrency(text: string): string {
  const upper = text.toUpperCase();
  const counts = CURRENCY_CODES.map((c) => [c, (upper.match(new RegExp(`\\b${c}\\b`, 'g')) || []).length] as const).sort((a, b) => b[1] - a[1]);
  if (counts[0][1] > 0) return counts[0][0];
  if (/₹|\bRS\.?\b/i.test(text)) return 'INR';
  if (/€/.test(text)) return 'EUR';
  if (/£/.test(text)) return 'GBP';
  if (/\bDHS?\b|د\.إ/i.test(text)) return 'AED';
  if (/\$/.test(text)) return 'USD';
  return '';
}

/** Amount following a label on the same row (last number on the row wins). */
function labelled(rows: Row[], label: RegExp, exclude?: RegExp): { value: number; conf: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!label.test(r.text) || (exclude && exclude.test(r.text))) continue;
    const after = r.text.replace(label, '|').split('|').slice(1).join(' ');
    const nums = after.match(new RegExp(NUM, 'g'));
    if (!nums) continue;
    const v = parseAmount(nums[nums.length - 1]);
    if (v !== null) return { value: v, conf: r.conf };
  }
  return null;
}

const TOTALS_RE = /^\s*(sub\s*-?\s*total|total|grand\s*total|net\s*total|vat|gst|tax|freight|shipping|discount|amount\s*due|balance|round)/i;

function parseItemRow(text: string, idx: number, conf: number): { item: ExtractedLineItem; ok: boolean } | null {
  // strip currency words/symbols so trailing numbers line up
  const clean = text.replace(/\b(USD|AED|INR|EUR|GBP)\b|[$€£₹]/gi, ' ').replace(/\s{2,}/g, '  ').trim();
  const numRe = /(?<![A-Za-z0-9\-])-?\d[\d.,]*(?![A-Za-z0-9\-])/g;
  const matches = Array.from(clean.matchAll(numRe));
  if (matches.length < 3) return null;
  const tail = matches.slice(-3);
  const [qtyM, unitM, amtM] = tail;
  const qty = parseAmount(qtyM[0]);
  const unit = parseAmount(unitM[0]);
  const amt = parseAmount(amtM[0]);
  if (qty === null || unit === null || amt === null || qty <= 0 || !Number.isInteger(qty)) return null;
  const head = clean.slice(0, qtyM.index).trim();
  if (head.length < 2) return null;
  // SKU: last token of the head that looks like a code (has a digit, or hyphenated caps)
  const tokens = head.split(/\s{2,}|\s+/);
  let sku = '';
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && /^[A-Z0-9][A-Z0-9\-_./]{2,}$/i.test(last) && /\d|-/.test(last)) {
    sku = last;
    tokens.pop();
  }
  const description = tokens.join(' ').trim();
  if (!description) return null;
  const consistent = Math.abs(qty * unit - amt) <= Math.max(0.02, amt * 0.005);
  return {
    ok: consistent && conf >= LOW_CONF,
    item: {
      id: `item-${idx + 1}-${Date.now()}`,
      description,
      productCode: sku,
      sku,
      quantity: qty,
      unitPrice: unit,
      amount: amt,
    },
  };
}

export function parseInvoiceFromOcr(result: OcrResult, fileName = ''): ExtractedDocumentData {
  const rows = toRows(result);
  const fullText = rows.map((r) => r.text).join('\n');
  const review = new Set<string>();
  const warnings: string[] = [];
  const fieldConfidence: Record<string, number> = {};
  const usedOcr = result.pages.some((p) => p.source === 'ocr');

  const flag = (field: string, conf?: number) => {
    if (conf !== undefined) fieldConfidence[field] = conf;
    if (conf === undefined || conf < LOW_CONF) review.add(field);
  };

  // --- document type ---
  let documentType: ExtractedDocumentData['documentType'] = 'OTHER';
  const hay = `${fullText.slice(0, 600)} ${fileName}`.toLowerCase();
  if (/pro\s*-?forma|quotation|\bquote\b/.test(hay)) documentType = 'PROFORMA';
  else if (/tax\s+invoice|commercial\s+invoice|\binvoice\b/.test(hay)) documentType = 'TAX_INVOICE';
  else if (/purchase\s+order/.test(hay)) documentType = 'PURCHASE_INVOICE';
  if (documentType === 'OTHER') review.add('documentType');

  // --- document number ---
  let docNo = '';
  let docNoConf = 0;
  const noRe = /(?:invoice|inv|pro\s*-?forma|quotation|quote|pi)\s*(?:no\.?|number|num|#|id)?\s*[:.#\-]?\s*([A-Z0-9][A-Z0-9\-\/_.]{2,})/i;
  for (const r of rows.slice(0, 40)) {
    const m = r.text.match(noRe);
    if (m && /\d/.test(m[1]) && !/^(date|total)/i.test(m[1])) {
      docNo = m[1].replace(/[.,]+$/, '');
      docNoConf = r.conf;
      break;
    }
  }
  flag('invoiceNumber', docNo ? docNoConf : undefined);
  if (result.pages.some((p) => p.source === 'ocr') && docNo) review.add('invoiceNumber'); // IDs are OCR-fragile: always eyeball

  // --- dates ---
  let invoiceDate = '';
  let dueDate = '';
  for (const r of rows) {
    const d = parseDate(r.text);
    if (!d) continue;
    if (/due|payment\s*date|valid|expir/i.test(r.text)) {
      if (!dueDate) dueDate = d.iso;
    } else if (!invoiceDate) {
      invoiceDate = d.iso;
      flag('invoiceDate', d.ambiguous ? 0.5 : r.conf);
      if (d.ambiguous) warnings.push(`Date "${r.text.match(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/)?.[0]}" read as day/month/year — confirm.`);
    }
  }
  if (!invoiceDate) flag('invoiceDate');

  // --- currency ---
  const currency = detectCurrency(fullText);
  if (!currency) review.add('currency');

  // --- parties ---
  const idxOf = (re: RegExp) => rows.findIndex((r) => re.test(r.text));
  const partyAfter = (re: RegExp): { name: string; address: string; conf: number } | null => {
    const i = idxOf(re);
    if (i < 0) return null;
    const inline = rows[i].text.replace(re, '').replace(/^[\s:.\-]+/, '').trim();
    const lines: Row[] = [];
    if (inline) lines.push({ ...rows[i], text: inline });
    for (let j = i + 1; j < rows.length && lines.length < 4; j++) {
      const t = rows[j].text;
      if (!t.trim() || /^(description|item|s\.?no|sl)\b/i.test(t) || parseDate(t) || /(invoice|date|due|ship\s*to|phone|tel|email)\s*[:#]/i.test(t)) break;
      lines.push(rows[j]);
    }
    if (!lines.length) return null;
    return {
      name: lines[0].text.split(/\s{2,}/)[0].trim(),
      address: lines.slice(1).map((l) => l.text.split(/\s{2,}/)[0]).join(', '),
      conf: Math.min(...lines.map((l) => l.conf)),
    };
  };
  const bill = partyAfter(/\b(bill(?:ed)?\s*to|sold\s*to|customer|buyer|consignee|client)\b\s*[:.]?/i);
  const ship = partyAfter(/\bship(?:ped)?\s*to\b\s*[:.]?/i);
  const from = partyAfter(/\b(from|seller|vendor|supplier|exporter)\b\s*[:.]?/i);
  const customerName = bill?.name || '';
  flag('customerName', bill ? bill.conf : undefined);
  let supplierName = from?.name || '';
  if (!supplierName) {
    // Header guess: first cell of the first rows that is a plausible name (not a label/title).
    let guess: { text: string; conf: number } | null = null;
    for (const r of rows.filter((x) => x.page === 1).slice(0, 6)) {
      const cell = r.text.split(/\s{2,}/)[0].trim();
      if (/[A-Za-z]{3}/.test(cell) && !/:\s*$/.test(cell) && !/^(tax\s+)?invoice|pro\s*-?forma|quotation|date|page/i.test(cell)) {
        guess = { text: cell, conf: r.conf };
        break;
      }
    }
    if (guess) {
      supplierName = guess.text;
      flag('supplierName', Math.min(guess.conf, 0.6)); // header guess -> always review
    } else flag('supplierName');
  } else flag('supplierName', from!.conf);
  const email = fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || '';
  const phone = fullText.match(/(?:tel|phone|mob|ph)[^\d+]{0,10}(\+?\d[\d\s().-]{7,17}\d)/i)?.[1]?.trim() || '';

  // --- line items ---
  const items: ExtractedLineItem[] = [];
  const headerIdx = rows.findIndex((r) => /(description|item|product|particulars)/i.test(r.text) && /(qty|quantity|pcs|nos)/i.test(r.text));
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  let uncertainRows = 0;
  for (let i = start; i < rows.length; i++) {
    const t = rows[i].text;
    if (TOTALS_RE.test(t)) {
      if (items.length) break;
      continue;
    }
    if (/(description|item|product)\b.*\b(qty|quantity)/i.test(t)) continue; // repeated header on later pages
    const parsed = parseItemRow(t, items.length, rows[i].conf);
    if (!parsed) continue;
    if (!parsed.ok) uncertainRows++;
    items.push(parsed.item);
  }
  if (!items.length) {
    review.add('lineItems');
    warnings.push('No line items could be read. Enter them manually.');
  } else {
    fieldConfidence.lineItems = uncertainRows ? 0.5 : 1;
    if (uncertainRows) {
      review.add('lineItems');
      warnings.push(`${uncertainRows} line item(s) have low OCR confidence or qty × price ≠ amount — verify against the original.`);
    }
  }

  // --- totals ---
  const sub = labelled(rows, /sub\s*-?\s*total/i);
  const grand = labelled(rows, /(grand\s*total|total\s*amount|amount\s*due|balance\s*due|invoice\s*total|net\s*total|^\s*total\b)/i, /sub\s*-?\s*total|total\s*(qty|quantity|weight|pcs)/i);
  const tax = labelled(rows, /\b(vat|gst|igst|cgst|sgst|tax)\b[^\d\n]*?(?:\(?\d+(?:\.\d+)?\s*%\)?)?[^\d\n]*?(?=\s*[$€£₹]?\s*\d)/i, /tax\s*invoice/i);
  const freight = labelled(rows, /(freight|shipping|delivery|courier)(?:\s*(?:charges?|cost|fee))?/i);
  const discount = labelled(rows, /discount(?:\s*amount)?/i);
  const other = labelled(rows, /(other\s*charges?|handling|packing|insurance|misc\w*)/i);

  const tot = {
    subtotal: sub?.value ?? 0,
    taxAmount: tax?.value ?? 0,
    discountAmount: Math.abs(discount?.value ?? 0),
    shippingCharges: freight?.value ?? 0,
    otherCharges: other?.value ?? 0,
    grandTotal: grand?.value ?? 0,
  };
  flag('subtotal', sub?.conf);
  flag('grandTotal', grand?.conf);
  if (tax) flag('taxAmount', tax.conf);
  if (freight) flag('shippingCharges', freight.conf);
  if (discount) flag('discountAmount', discount.conf);
  if (other) flag('otherCharges', other.conf);
  if (usedOcr) {
    // Totals in scans: numbers are the most error-prone part, always require a look.
    review.add('grandTotal');
    if (sub) review.add('subtotal');
  }

  // Consistency checks (report, never overwrite)
  const round = (n: number) => Math.round(n * 100) / 100;
  const itemsSum = round(items.reduce((s, i) => s + i.amount, 0));
  if (items.length && sub && Math.abs(itemsSum - sub.value) > 0.05) {
    review.add('subtotal');
    review.add('lineItems');
    warnings.push(`Line items add up to ${itemsSum.toFixed(2)} but the document subtotal reads ${sub.value.toFixed(2)}.`);
  }
  if (!sub && items.length) {
    tot.subtotal = itemsSum; // derived, not read — flag it
    review.add('subtotal');
    warnings.push('Subtotal was not found; it was calculated from line items.');
  }
  if (grand) {
    const expected = round(tot.subtotal + tot.taxAmount + tot.shippingCharges + tot.otherCharges - tot.discountAmount);
    if (tot.subtotal && Math.abs(expected - grand.value) > 0.05) {
      review.add('grandTotal');
      warnings.push(`Subtotal + tax + freight + other − discount = ${expected.toFixed(2)} but the document total reads ${grand.value.toFixed(2)}.`);
    }
  } else {
    warnings.push('Grand total was not found.');
  }

  const confs = rows.map((r) => r.conf);
  const avg = confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : 0;
  if (!rows.length) warnings.push('No text could be read from this file.');
  if (result.truncated) warnings.push('Only the first pages were processed.');

  return {
    documentType,
    invoiceNumber: docNo,
    proformaNumber: documentType === 'PROFORMA' ? docNo : undefined,
    customerName,
    supplierName,
    companyName: customerName,
    email,
    phone,
    billingAddress: bill?.address || '',
    shippingAddress: ship ? [ship.name, ship.address].filter(Boolean).join(', ') : '',
    invoiceDate,
    dueDate,
    currency,
    paymentTerms: fullText.match(/(?:payment\s*terms?|terms)\s*[:\-]\s*(.+)/i)?.[1]?.trim() || '',
    ...tot,
    lineItems: items,
    rawConfidence: Math.round(avg * 100) / 100,
    isScannedOcr: usedOcr,
    pageCount: result.pageCount,
    notes: undefined,
    reviewFields: Array.from(review),
    fieldConfidence,
    warnings,
    ocrEngine: 'PaddleOCR',
  };
}
