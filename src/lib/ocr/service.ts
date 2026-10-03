/**
 * OCR document intake service: persistence, processing, editing, audit trail.
 * Conversion into ERP documents lives in conversion.ts and reuses the ERP's own services.
 */
import 'server-only';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { runOcr, OcrError, type OcrContractResponse } from '@/lib/ocr-client';
import { readOriginal, removeOriginal, storeOriginal } from './file-store';
import { isCloudinaryError, userFacingCloudinaryMessage } from '@/lib/cloudinary';
import { classify } from './classify';
import { matchCustomer, matchSupplier, matchProducts } from './matching';
import { DOC_TYPE_OPTIONS, OcrDocType, partyFor } from './doc-types';

export interface Actor { id: string; name: string }
export class OcrModuleError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

const STALE_PROCESSING_MS = 6 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function sniffFile(b: Buffer): { ext: string; mime: string } | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}
export const hashOf = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export async function addEvent(docId: string, type: string, message: string, actor?: Actor | null, meta?: Prisma.InputJsonValue) {
  await prisma.ocrDocumentEvent.create({ data: { ocrDocumentId: docId, type, message, userId: actor?.id, userName: actor?.name, meta } });
}

// ── engine field names -> module field names ────────────────────────────────
const FIELD_MAP: Record<string, string> = {
  document_type: 'documentType', invoice_number: 'documentNumber', invoice_date: 'documentDate', due_date: 'dueDate',
  customer_name: 'customerName', supplier_name: 'supplierName', vat_number: 'vatNumber', currency: 'currency',
  subtotal: 'subtotal', discount: 'discountAmount', tax: 'taxAmount', freight: 'freightAmount',
  other_charges: 'otherCharges', total: 'totalAmount', line_items: 'lineItems', payment_terms: 'paymentTerms',
  paid: 'paidAmount', balance: 'balanceAmount', issuer_address: 'issuerAddress', issuer_phone: 'issuerPhone', issuer_email: 'issuerEmail',
  issuer_vat: 'issuerVat', issuer_corporate_tax: 'issuerCorporateTax', issuer_trade_license: 'issuerTradeLicense', issuer_duns: 'issuerDuns',
  customer_vat: 'vatNumber', customer_address: 'billingAddress', customer_email: 'contactEmail',
};
const mapField = (f: string) => FIELD_MAP[f] ?? f;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dateOrNull = (v: unknown) => { const d = v ? new Date(String(v)) : null; return d && !isNaN(d.getTime()) ? d : null; };
const r2 = (n: number) => Math.round(n * 100) / 100;

async function ourCompanyNames(): Promise<string[]> {
  const s = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } }).catch(() => null);
  return [s?.companyName, s?.tradingName].filter((x): x is string => !!x);
}

function lineFromContract(it: any, i: number) {
  const qty = num(it.quantity), unit = num(it.unit_price), disc = num(it.discount), tax = num(it.tax), total = num(it.total);
  const base = qty * unit - disc;
  const readings = [qty * unit, qty * unit - disc, qty * unit - disc + tax, qty * unit + tax];
  return {
    position: i, description: String(it.description ?? ''), sku: String(it.sku ?? ''), quantity: qty, unit: String(it.unit ?? ''),
    unitPrice: unit, discount: disc, taxAmount: tax, total,
    taxRate: it.tax_rate !== undefined && it.tax_rate !== null ? num(it.tax_rate) : base > 0 && tax > 0 ? r2((tax / base) * 100) : 0,
    lowConfidence: !readings.some((v) => Math.abs(v - total) <= Math.max(0.02, Math.abs(total) * 0.005)) || num(it.confidence) < 0.6,
    confidence: num(it.confidence), page: Math.max(1, num(it.page) || 1),
  };
}

// ── upload / processing ─────────────────────────────────────────────────────
export async function createFromUpload(p: { buffer: Buffer; fileName: string; user: Actor; allowDuplicate?: boolean }) {
  const kind = sniffFile(p.buffer);
  if (!p.buffer.length) throw new OcrModuleError(400, 'The uploaded file is empty.');
  if (p.buffer.length > MAX_UPLOAD_BYTES) throw new OcrModuleError(413, 'File is too large (max 15 MB).');
  if (!kind) throw new OcrModuleError(415, 'Unsupported file. Upload a PDF, JPG or PNG.');

  const fileHash = hashOf(p.buffer);
  if (!p.allowDuplicate) {
    const existing = await prisma.ocrDocument.findFirst({ where: { fileHash }, orderBy: { createdAt: 'desc' } });
    if (existing) throw new OcrModuleError(409, 'This exact file has already been uploaded.', { existingId: existing.id, code: 'duplicate_file' });
  }
  let stored;
  try {
    stored = await storeOriginal(p.buffer, kind.mime, kind.ext);
  } catch (e: any) {
    // a Cloudinary failure was already logged with status / X-Cld-Error by the storage layer
    if (!isCloudinaryError(e)) console.error('[OCR] storing original failed:', e?.message);
    const detail = isCloudinaryError(e) ? userFacingCloudinaryMessage(e) : `(${e?.message || 'storage unavailable'})`;
    throw new OcrModuleError(503, `File storage failed. Nothing was saved. ${detail}`);
  }
  console.log(`[OCR] OCR document upload successful | provider=${stored.provider} | type=${kind.mime} | size=${p.buffer.length}`);
  const doc = await prisma.ocrDocument.create({
    data: {
      fileName: p.fileName.slice(0, 200), fileType: kind.mime, fileSize: p.buffer.length, fileHash,
      storageProvider: stored.provider, storageKey: stored.key,
      createdById: p.user.id, createdByName: p.user.name,
    },
  });
  await addEvent(doc.id, 'UPLOADED', `Uploaded ${doc.fileName} (${(doc.fileSize / 1024).toFixed(0)} KB)`, p.user);
  return doc;
}

/** Runs the OCR engine on the stored original and (re)fills the record. Never touches ERP documents. */
export async function processDocument(id: string, user: Actor, mode: 'initial' | 'reprocess' = 'initial') {
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) throw new OcrModuleError(404, 'OCR document not found.');
  if (doc.conversionStatus === 'CONVERTED' || doc.conversionStatus === 'CONVERTING') {
    throw new OcrModuleError(409, 'This document has already been converted and cannot be reprocessed.');
  }
  // Atomic claim so two requests cannot run OCR on the same record at once.
  const claim = await prisma.ocrDocument.updateMany({
    where: { id, processingStatus: { not: 'PROCESSING' } },
    data: { processingStatus: 'PROCESSING', failureReason: null },
  });
  if (claim.count !== 1) throw new OcrModuleError(409, 'This document is already being processed.');
  await addEvent(id, 'OCR_STARTED', mode === 'reprocess' ? 'OCR reprocessing started' : 'OCR started', user);

  try {
    const original = await readOriginal(doc.storageProvider, doc.storageKey);
    const result = await runOcr(original, doc.fileName);
    await applyResult(id, result, user, mode);
    console.log(`[OCR] OCR processing successful | id=${id} | type=${result.document_type} | pages=${Array.isArray((result as any).pages) ? (result as any).pages.length : 'n/a'}`);
  } catch (e: any) {
    const message = e instanceof OcrError ? e.message
      : isCloudinaryError(e) ? `The stored original could not be read back from Cloudinary: ${e.message}${e.httpCode ? ` (HTTP ${e.httpCode})` : ''}`
      : 'Document reading failed unexpectedly.';
    if (!(e instanceof OcrError) && !(isCloudinaryError(e))) console.error('[OCR] processing failed:', e?.message);
    await prisma.ocrDocument.update({ where: { id }, data: { processingStatus: 'FAILED', failureReason: message } });
    await addEvent(id, 'OCR_FAILED', `OCR failed: ${message}`, user);
    throw e instanceof OcrError ? e : new OcrModuleError(500, message);
  }
  return getDetail(id);
}

async function applyResult(id: string, r: OcrContractResponse, user: Actor, mode: string) {
  const d = r.data;
  const ours = await ourCompanyNames();
  const cls = classify(r.document_type, (r as any).type_confidence ?? r.confidence, String(d.supplier_name ?? ''), String(d.customer_name ?? ''), ours);
  const lines = d.line_items.map(lineFromContract);
  const review = new Set((r.review_fields || []).map(mapField));
  if (cls.needsReview || cls.confidence < 0.7) review.add('documentType');
  // A supplier read from the header of our own sales document is our company: nothing to check.
  if (cls.direction === 'sales') review.delete('supplierName');
  const warnings = [...(r.warnings || [])];
  if (cls.needsReview) warnings.push(cls.reason);
  if (lines.some((l) => l.lowConfidence)) review.add('lineItems');

  const fieldMeta = Object.fromEntries(Object.entries(r.fields || {}).map(([k, v]) => [mapField(k), { confidence: v.confidence, level: v.level, page: v.page }]));
  const fieldConfidence = Object.fromEntries(Object.entries(r.field_confidence || {}).map(([k, v]) => [mapField(k), v]));
  // matching (suggestions are applied only when unambiguous; the user still confirms)
  const party = partyFor(cls.type);
  const custName = String(d.customer_name ?? ''), suppName = String(d.supplier_name ?? '');
  const custMatch = party === 'customer' ? await matchCustomer({ name: custName, email: d.email, vat: d.customer_vat || d.vat_number }) : null;
  const suppMatch = party === 'supplier' ? await matchSupplier({ name: suppName, email: d.issuer_email, vat: d.issuer_vat }) : null;
  const prodMatches = await matchProducts(lines.map((l) => ({ sku: l.sku, description: l.description })));

  const status = review.size > 0 || warnings.length > 0 ? 'NEEDS_REVIEW' : 'PROCESSED';
  await prisma.$transaction(async (tx) => {
    await tx.ocrRawResult.create({ data: { ocrDocumentId: id, engine: r.engine || 'OCR', payload: r as unknown as Prisma.InputJsonValue } });
    await tx.ocrLineItem.deleteMany({ where: { ocrDocumentId: id } });
    await tx.ocrDocument.update({
      where: { id },
      data: {
        pageCount: r.page_count ?? 1,
        detectedDocumentType: cls.type, documentType: cls.type,
        typeConfidence: Math.round(cls.confidence * 1000) / 1000, confidence: r.confidence,
        processingStatus: status, failureReason: null,
        documentNumber: String(d.invoice_number ?? ''), documentDate: dateOrNull(d.invoice_date), dueDate: dateOrNull(d.due_date),
        supplierName: suppName, customerName: custName, vatNumber: String(d.customer_vat ?? d.vat_number ?? ''), currency: String(d.currency ?? ''),
        issuerAddress: String(d.issuer_address ?? ''), issuerPhone: String(d.issuer_phone ?? ''), issuerEmail: String(d.issuer_email ?? ''), issuerVat: String(d.issuer_vat ?? ''),
        issuerCorporateTax: String(d.issuer_corporate_tax ?? ''), issuerTradeLicense: String(d.issuer_trade_license ?? ''), issuerDuns: String(d.issuer_duns ?? ''),
        paidAmount: num(d.paid), balanceAmount: num(d.balance), ocrEngine: r.engine || '', processingMs: num(r.metrics?.processing_ms),
        fieldMeta: fieldMeta as unknown as Prisma.InputJsonValue,
        subtotal: num(d.subtotal), discountAmount: num(d.discount), taxAmount: num(d.tax), freightAmount: num(d.freight),
        otherCharges: num(d.other_charges), totalAmount: num(d.total), paymentTerms: String(d.payment_terms ?? ''),
        contactEmail: String(d.email ?? ''), contactPhone: String(d.phone ?? ''),
        billingAddress: String(d.billing_address ?? ''), shippingAddress: String(d.shipping_address ?? ''),
        reviewFields: Array.from(review), warnings, fieldConfidence,
        matchedCustomerId: custMatch?.strong ? custMatch.candidates[0].id : null,
        matchedSupplierId: suppMatch?.strong ? suppMatch.candidates[0].id : null,
        lineItems: {
          create: lines.map((l, i) => ({ ...l, matchedProductId: prodMatches[i]?.strong ? prodMatches[i].candidates[0].id : null })),
        },
      },
    });
  });
  await addEvent(id, 'OCR_COMPLETED', `OCR completed (${r.engine || 'engine'}, ${lines.length} line item${lines.length === 1 ? '' : 's'}, ${Math.round(r.confidence * 100)}% confidence)`, user);
  await addEvent(id, 'TYPE_DETECTED', `Detected ${DOC_TYPE_OPTIONS.find((o) => o.value === cls.type)?.label} (${Math.round(cls.confidence * 100)}%). ${cls.reason}`, user);
  if (custMatch?.strong) await addEvent(id, 'CUSTOMER_MATCHED', `Customer matched: ${custMatch.candidates[0].label}`, user);
  if (suppMatch?.strong) await addEvent(id, 'SUPPLIER_MATCHED', `Supplier matched: ${suppMatch.candidates[0].label}`, user);
  const nMatched = prodMatches.filter((m) => m.strong).length;
  if (lines.length) await addEvent(id, 'PRODUCT_MATCHED', `Products matched automatically: ${nMatched} of ${lines.length}`, user);
}

/** Marks a finished/failed record as waiting for another OCR run (the worker picks it up). */
export async function requestReprocess(id: string, user: Actor) {
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) throw new OcrModuleError(404, 'OCR document not found.');
  if (doc.conversionStatus === 'CONVERTED' || doc.conversionStatus === 'CONVERTING') throw new OcrModuleError(409, 'This document has already been converted and cannot be reprocessed.');
  const claim = await prisma.ocrDocument.updateMany({ where: { id, processingStatus: { notIn: ['PROCESSING', 'UPLOADED'] } }, data: { processingStatus: 'UPLOADED', failureReason: null } });
  if (claim.count !== 1) throw new OcrModuleError(409, 'This document is already queued or being processed.');
  await addEvent(id, 'OCR_QUEUED', 'Reprocessing queued', user);
}

// ── reads ───────────────────────────────────────────────────────────────────
const detailInclude = { lineItems: { orderBy: { position: 'asc' as const } }, events: { orderBy: { createdAt: 'asc' as const } } };

async function healStale(doc: { id: string; processingStatus: string; updatedAt: Date }) {
  if (doc.processingStatus === 'PROCESSING' && Date.now() - doc.updatedAt.getTime() > STALE_PROCESSING_MS) {
    await prisma.ocrDocument.update({ where: { id: doc.id }, data: { processingStatus: 'FAILED', failureReason: 'Processing did not finish. Try reprocessing.' } });
  }
}

export async function getDetail(id: string) {
  const first = await prisma.ocrDocument.findUnique({ where: { id }, select: { id: true, processingStatus: true, updatedAt: true } });
  if (!first) throw new OcrModuleError(404, 'OCR document not found.');
  await healStale(first);
  const doc = await prisma.ocrDocument.findUniqueOrThrow({ where: { id }, include: detailInclude });
  const party = partyFor(doc.documentType as OcrDocType);
  const [customer, supplier, lineMatches] = await Promise.all([
    party === 'customer' ? matchCustomer({ name: doc.customerName, email: doc.contactEmail, vat: doc.vatNumber }) : null,
    party === 'supplier' ? matchSupplier({ name: doc.supplierName, email: doc.issuerEmail, vat: doc.issuerVat }) : null,
    matchProducts(doc.lineItems.map((l) => ({ sku: l.sku, description: l.description }))),
  ]);
  const [mc, ms, prods] = await Promise.all([
    doc.matchedCustomerId ? prisma.customer.findUnique({ where: { id: doc.matchedCustomerId }, select: { id: true, companyName: true, email: true, customerCode: true } }) : null,
    doc.matchedSupplierId ? prisma.supplier.findUnique({ where: { id: doc.matchedSupplierId }, select: { id: true, name: true, email: true } }) : null,
    doc.lineItems.some((l) => l.matchedProductId)
      ? prisma.product.findMany({ where: { id: { in: doc.lineItems.map((l) => l.matchedProductId).filter((x): x is string => !!x) } }, select: { id: true, name: true, sku: true } })
      : [],
  ]);
  return {
    ...doc,
    matchedCustomer: mc, matchedSupplier: ms,
    lineItems: doc.lineItems.map((l, i) => ({ ...l, matchedProduct: prods.find((p) => p.id === l.matchedProductId) ?? null, suggestions: lineMatches[i]?.candidates ?? [] })),
    suggestions: { customer: customer?.candidates ?? [], supplier: supplier?.candidates ?? [] },
  };
}

export interface ListQuery { q?: string; type?: string; status?: string; conversion?: string; from?: string; to?: string; page: number; limit: number }
export async function listDocuments(q: ListQuery) {
  const where: Prisma.OcrDocumentWhereInput = {};
  if (q.q) {
    const c = { contains: q.q, mode: 'insensitive' as const };
    where.OR = [{ fileName: c }, { documentNumber: c }, { customerName: c }, { supplierName: c }];
  }
  if (q.type) where.documentType = q.type as any;
  if (q.status) where.processingStatus = q.status as any;
  if (q.conversion) where.conversionStatus = q.conversion as any;
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(new Date(q.to).getTime() + 86400000 - 1) } : {}) };
  const [items, total] = await Promise.all([
    prisma.ocrDocument.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.ocrDocument.count({ where }),
  ]);
  await Promise.all(items.map(healStale));
  return { items, total, page: q.page, limit: q.limit };
}

// ── editing ─────────────────────────────────────────────────────────────────
const STR = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const NUMF = (v: unknown, label: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new OcrModuleError(400, `${label} must be a non-negative number.`);
  return n;
};

export async function updateDocument(id: string, patch: any, user: Actor) {
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, include: { lineItems: true } });
  if (!doc) throw new OcrModuleError(404, 'OCR document not found.');
  if (doc.conversionStatus === 'CONVERTED' || doc.conversionStatus === 'CONVERTING') throw new OcrModuleError(409, 'A converted document can no longer be edited.');
  if (doc.processingStatus === 'PROCESSING') throw new OcrModuleError(409, 'The document is still being processed.');

  const data: Prisma.OcrDocumentUncheckedUpdateInput = {};
  const changed: string[] = [];
  const changedKeys: string[] = [];
  const set = (k: keyof typeof doc, v: any, label: string) => { (data as any)[k] = v; if (JSON.stringify((doc as any)[k]) !== JSON.stringify(v)) { changed.push(label); changedKeys.push(k as string); } };

  for (const [k, label] of [['documentNumber', 'document number'], ['supplierName', 'supplier'], ['customerName', 'customer'], ['vatNumber', 'VAT number'], ['paymentTerms', 'payment terms'], ['contactEmail', 'email'], ['contactPhone', 'phone'], ['billingAddress', 'customer address'], ['shippingAddress', 'shipping address'], ['issuerAddress', 'company address'], ['issuerPhone', 'company phone'], ['issuerEmail', 'company email'], ['issuerVat', 'company VAT/TRN'], ['issuerCorporateTax', 'corporate tax no.'], ['issuerTradeLicense', 'trade licence no.'], ['issuerDuns', 'D-U-N-S no.']] as const) {
    if (patch[k] !== undefined) set(k, STR(patch[k], 500), label);
  }
  if (patch.currency !== undefined) set('currency', STR(patch.currency, 3).toUpperCase(), 'currency');
  for (const [k, label] of [['subtotal', 'subtotal'], ['discountAmount', 'discount'], ['taxAmount', 'tax'], ['freightAmount', 'freight'], ['otherCharges', 'other charges'], ['totalAmount', 'total'], ['paidAmount', 'paid'], ['balanceAmount', 'balance']] as const) {
    if (patch[k] !== undefined) set(k, NUMF(patch[k], label), label);
  }
  for (const [k, label] of [['documentDate', 'document date'], ['dueDate', 'due date']] as const) {
    if (patch[k] !== undefined) {
      const d = patch[k] ? dateOrNull(patch[k]) : null;
      if (patch[k] && !d) throw new OcrModuleError(400, `Invalid ${label}.`);
      data[k] = d;
      if ((doc[k]?.toISOString().slice(0, 10) ?? null) !== (d?.toISOString().slice(0, 10) ?? null)) { changed.push(label); changedKeys.push(k); }
    }
  }
  if (patch.documentType !== undefined) {
    if (!DOC_TYPE_OPTIONS.some((o) => o.value === patch.documentType)) throw new OcrModuleError(400, 'Unknown document type.');
    set('documentType', patch.documentType, 'document type');
  }
  if (patch.matchedCustomerId !== undefined) {
    if (patch.matchedCustomerId && !(await prisma.customer.findUnique({ where: { id: patch.matchedCustomerId }, select: { id: true } }))) throw new OcrModuleError(400, 'Selected customer does not exist.');
    data.matchedCustomerId = patch.matchedCustomerId || null;
  }
  if (patch.matchedSupplierId !== undefined) {
    if (patch.matchedSupplierId && !(await prisma.supplier.findUnique({ where: { id: patch.matchedSupplierId }, select: { id: true } }))) throw new OcrModuleError(400, 'Selected supplier does not exist.');
    data.matchedSupplierId = patch.matchedSupplierId || null;
  }

  let newLines: any[] | null = null;
  if (patch.lineItems !== undefined) {
    if (!Array.isArray(patch.lineItems) || patch.lineItems.length > 500) throw new OcrModuleError(400, 'lineItems must be an array of at most 500 lines.');
    const productIds = patch.lineItems.map((l: any) => l.matchedProductId).filter(Boolean);
    const found = productIds.length ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } }) : [];
    newLines = patch.lineItems.map((l: any, i: number) => {
      if (l.matchedProductId && !found.some((f) => f.id === l.matchedProductId)) throw new OcrModuleError(400, `Line ${i + 1}: selected product does not exist.`);
      const rate = Number(l.taxRate ?? 0);
      if (!(rate >= 0 && rate <= 100)) throw new OcrModuleError(400, `Line ${i + 1}: tax % must be between 0 and 100.`);
      return {
        ocrDocumentId: id, position: i, description: STR(l.description, 500), sku: STR(l.sku, 100), unit: STR(l.unit, 20),
        quantity: NUMF(l.quantity ?? 0, `Line ${i + 1} quantity`), unitPrice: NUMF(l.unitPrice ?? 0, `Line ${i + 1} unit price`),
        discount: NUMF(l.discount ?? 0, `Line ${i + 1} discount`), taxRate: rate, taxAmount: NUMF(l.taxAmount ?? 0, `Line ${i + 1} tax`),
        total: NUMF(l.total ?? 0, `Line ${i + 1} total`), lowConfidence: false, confidence: 1, page: 1, matchedProductId: l.matchedProductId || null,
      };
    });
  }
  const confirm = patch.confirm === true;
  if (confirm) data.processingStatus = 'CONFIRMED';
  else if (doc.processingStatus === 'CONFIRMED' && (changed.length || newLines)) data.processingStatus = 'NEEDS_REVIEW'; // edits invalidate a previous confirmation
  // Fields the user has now edited no longer need review.
  const edited = new Set(changedKeys);
  if (changed.length || newLines) {
    const keep = (doc.reviewFields || []).filter((f) => !edited.has(f) && !(newLines && f === 'lineItems') );
    data.reviewFields = keep;
  }

  await prisma.$transaction(async (tx) => {
    if (newLines) {
      await tx.ocrLineItem.deleteMany({ where: { ocrDocumentId: id } });
      await tx.ocrLineItem.createMany({ data: newLines });
    }
    await tx.ocrDocument.update({ where: { id }, data });
  });

  if (changed.length || newLines) await addEvent(id, 'DATA_EDITED', `Data edited${changed.length ? `: ${changed.join(', ')}` : ''}${newLines ? `${changed.length ? '; ' : ': '}line items (${newLines.length})` : ''}`, user);
  if (patch.matchedCustomerId !== undefined && (patch.matchedCustomerId || null) !== doc.matchedCustomerId) await addEvent(id, 'CUSTOMER_MATCHED', patch.matchedCustomerId ? 'Customer selected' : 'Customer selection cleared', user);
  if (patch.matchedSupplierId !== undefined && (patch.matchedSupplierId || null) !== doc.matchedSupplierId) await addEvent(id, 'SUPPLIER_MATCHED', patch.matchedSupplierId ? 'Supplier selected' : 'Supplier selection cleared', user);
  if (newLines) {
    const before = doc.lineItems.filter((l) => l.matchedProductId).length, after = newLines.filter((l) => l.matchedProductId).length;
    if (before !== after) await addEvent(id, 'PRODUCT_MATCHED', `Products matched: ${after} of ${newLines.length}`, user);
  }
  if (confirm) await addEvent(id, 'CONFIRMED', 'Data reviewed and confirmed', user);
  return getDetail(id);
}

export async function deleteDocument(id: string, user: Actor) {
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) throw new OcrModuleError(404, 'OCR document not found.');
  if (doc.conversionStatus === 'CONVERTING') throw new OcrModuleError(409, 'A conversion is in progress.');
  await prisma.ocrDocument.delete({ where: { id } });
  await removeOriginal(doc.storageProvider, doc.storageKey);
  console.log(`[OCR] ${user.name} deleted OCR document ${id} (${doc.conversionStatus})`);
  return { deleted: true, wasConverted: doc.conversionStatus === 'CONVERTED', convertedDocumentNumber: doc.convertedDocumentNumber };
}
