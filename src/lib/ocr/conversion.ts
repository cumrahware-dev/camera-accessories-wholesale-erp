/**
 * OCR -> ERP conversion. Thin adapter: every destination is created by the ERP's own service
 * (proforma-service), so numbering, tax, freight, workflow rules, e-mails and audit stay identical
 * to documents created by hand. Nothing here writes ERP tables directly.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { confirmProforma, convertProformaToInvoice, createProforma, ServiceError } from '@/lib/services/proforma-service';
import { DESTINATIONS, DestinationKey, OcrDocType, destinationsFor } from './doc-types';
import { validateForConversion } from './validation';
import { addEvent, Actor, OcrModuleError, getDetail } from './service';

export interface Duplicate { kind: string; id: string; number: string; reason: string; link: string }

async function companyCurrency(): Promise<string> {
  const s = await prisma.companySettings.findUnique({ where: { id: 'global-settings' } }).catch(() => null);
  return s?.currency || 'USD';
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Looks for the same document already in the OCR module or the ERP. Never blocks on its own. */
export async function findDuplicates(id: string): Promise<Duplicate[]> {
  const doc = await prisma.ocrDocument.findUniqueOrThrow({ where: { id } });
  const out: Duplicate[] = [];
  const others = await prisma.ocrDocument.findMany({
    where: { id: { not: id }, OR: [{ fileHash: doc.fileHash }, ...(doc.documentNumber ? [{ documentNumber: { equals: doc.documentNumber, mode: 'insensitive' as const } }] : [])] },
    take: 10,
  });
  for (const o of others) {
    if (o.fileHash === doc.fileHash) out.push({ kind: 'OCR document', id: o.id, number: o.fileName, reason: 'Identical file already uploaded', link: `/ocr/${o.id}` });
    else if (near(o.totalAmount, doc.totalAmount) && (o.customerName === doc.customerName || o.supplierName === doc.supplierName)) {
      out.push({ kind: 'OCR document', id: o.id, number: o.documentNumber, reason: 'Same number, party and total', link: `/ocr/${o.id}` });
    }
  }
  if (doc.matchedCustomerId && doc.totalAmount > 0) {
    const day0 = doc.documentDate ? new Date(day(doc.documentDate)) : null;
    const [pfs, invs] = await Promise.all([
      prisma.proforma.findMany({ where: { customerId: doc.matchedCustomerId, grandTotal: { gte: doc.totalAmount - 0.01, lte: doc.totalAmount + 0.01 } }, take: 5, orderBy: { createdAt: 'desc' } }),
      prisma.taxInvoice.findMany({ where: { customerId: doc.matchedCustomerId, grandTotal: { gte: doc.totalAmount - 0.01, lte: doc.totalAmount + 0.01 } }, take: 5, orderBy: { createdAt: 'desc' } }),
    ]);
    for (const p of pfs) out.push({ kind: 'Proforma', id: p.id, number: p.proformaNumber, reason: 'Same customer and total amount', link: `/proformas/${p.id}` });
    for (const i of invs) out.push({ kind: 'Tax Invoice', id: i.id, number: i.invoiceNumber, reason: 'Same customer and total amount', link: `/invoices/${i.id}` });
    void day0;
  }
  if (doc.documentNumber) {
    const [pf, inv] = await Promise.all([
      prisma.proforma.findFirst({ where: { proformaNumber: { equals: doc.documentNumber, mode: 'insensitive' } } }),
      prisma.taxInvoice.findFirst({ where: { invoiceNumber: { equals: doc.documentNumber, mode: 'insensitive' } } }),
    ]);
    if (pf) out.push({ kind: 'Proforma', id: pf.id, number: pf.proformaNumber, reason: 'Same document number', link: `/proformas/${pf.id}` });
    if (inv) out.push({ kind: 'Tax Invoice', id: inv.id, number: inv.invoiceNumber, reason: 'Same document number', link: `/invoices/${inv.id}` });
  }
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.kind + d.id) ? false : (seen.add(d.kind + d.id), true)));
}

/** Builds the payload for the ERP proforma service from the reviewed OCR data. */
function proformaPayload(doc: any, dryRun: boolean) {
  const gross = doc.lineItems.reduce((s: number, l: any) => s + l.quantity * l.unitPrice, 0);
  const lineDisc = doc.lineItems.reduce((s: number, l: any) => s + l.discount, 0);
  // The ERP takes discount once, at document level, and taxes each line after its own line discount.
  // When the printed line discounts add up to the printed document discount they are the same money,
  // so pass them as line discounts (correct tax base) and keep the document-level amount for the total.
  const lineDiscountsAreTheHeaderDiscount = lineDisc > 0 && near(lineDisc, doc.discountAmount);
  const discountPercent = gross > 0 ? (doc.discountAmount / gross) * 100 : 0;
  const days = doc.dueDate ? Math.max(1, Math.ceil((doc.dueDate.getTime() - Date.now()) / 86400000)) : undefined;
  return {
    dryRun,
    customerId: doc.matchedCustomerId,
    items: doc.lineItems.map((l: any) => ({
      productId: l.matchedProductId, productSku: l.sku || undefined, productName: l.description,
      quantity: l.quantity, unitPrice: l.unitPrice,
      discountPercent: lineDiscountsAreTheHeaderDiscount && l.quantity * l.unitPrice > 0 ? (l.discount / (l.quantity * l.unitPrice)) * 100 : 0,
      taxRate: l.taxRate,
    })),
    discountPercent,
    shippingCost: Math.round((doc.freightAmount + doc.otherCharges) * 100) / 100,
    paymentTerms: doc.paymentTerms || undefined,
    expiryDays: days,
    notes: `Created from OCR document "${doc.fileName}" (document no. ${doc.documentNumber}${doc.documentDate ? `, dated ${day(doc.documentDate)}` : ''}).`,
  };
}

export async function previewConversion(id: string, destination: DestinationKey) {
  const doc = await prisma.ocrDocument.findUniqueOrThrow({ where: { id }, include: { lineItems: { orderBy: { position: 'asc' } } } });
  const currency = await companyCurrency();
  const v = validateForConversion(doc as any, destination, currency);
  const duplicates = await findDuplicates(id);
  let erpTotals: any = null;
  if (DESTINATIONS[destination].available && v.errors.length === 0) {
    try {
      erpTotals = await createProforma(proformaPayload(doc, true));
      if (Math.abs(erpTotals.grandTotal - doc.totalAmount) > 0.05) {
        v.errors.push(`The ERP would record a total of ${erpTotals.grandTotal.toFixed(2)} (its own tax and discount rules) but the document total is ${doc.totalAmount.toFixed(2)}. Check tax % and discount on each line.`);
      }
    } catch (e: any) {
      v.errors.push(e instanceof ServiceError ? e.message : 'The ERP could not price this document.');
    }
  }
  return { ...v, duplicates, erpTotals };
}

export interface ConvertOptions { destination: DestinationKey; acknowledgeDuplicates?: boolean; acknowledgeInvoiceWorkflow?: boolean; depotId?: string }

export async function convertDocument(id: string, opts: ConvertOptions, user: Actor & { role: string }) {
  const dest = DESTINATIONS[opts.destination];
  if (!dest) throw new OcrModuleError(400, 'Unknown destination.');
  const doc0 = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc0) throw new OcrModuleError(404, 'OCR document not found.');
  if (!destinationsFor(doc0.documentType as OcrDocType).some((d) => d.key === opts.destination)) {
    throw new OcrModuleError(400, `${dest.label} is not a valid destination for a ${doc0.documentType.toLowerCase().replace('_', ' ')}.`);
  }
  // Destination-specific ERP permissions are enforced on top of ocr.convert - OCR never widens access.
  const need = opts.destination === 'TAX_INVOICE' ? (['proformas.write', 'invoices.write'] as const) : (['proformas.write'] as const);
  for (const p of need) if (!hasPermission(user.role, p)) throw new OcrModuleError(403, `Your role cannot create a ${dest.label}.`);
  if (doc0.conversionStatus === 'CONVERTED') throw new OcrModuleError(409, `Already converted to ${doc0.convertedDocumentNumber}.`, { convertedDocumentId: doc0.convertedDocumentId });
  if (doc0.processingStatus === 'PROCESSING' || doc0.processingStatus === 'FAILED' || doc0.processingStatus === 'UPLOADED') {
    throw new OcrModuleError(409, 'Only a successfully processed document can be converted.');
  }

  const preview = await previewConversion(id, opts.destination);
  if (preview.errors.length) throw new OcrModuleError(422, 'The document cannot be converted yet.', { errors: preview.errors, warnings: preview.warnings });
  if (preview.duplicates.length && !opts.acknowledgeDuplicates) {
    throw new OcrModuleError(409, 'Possible duplicate document found.', { code: 'possible_duplicate', duplicates: preview.duplicates });
  }
  if (opts.destination === 'TAX_INVOICE' && !opts.acknowledgeInvoiceWorkflow) {
    throw new OcrModuleError(422, 'Confirm that creating a Tax Invoice also enters the Depot workflow.', { code: 'workflow_ack_required' });
  }

  // Atomic claim: a double-click or parallel request can never convert the same document twice.
  const claim = await prisma.ocrDocument.updateMany({
    where: { id, conversionStatus: { in: ['NOT_CONVERTED', 'FAILED'] } },
    data: { conversionStatus: 'CONVERTING', failureReason: null },
  });
  if (claim.count !== 1) throw new OcrModuleError(409, 'A conversion is already in progress or completed for this document.');
  await addEvent(id, 'CONVERSION_STARTED', `Conversion to ${dest.label} started`, user);

  try {
    const doc = await prisma.ocrDocument.findUniqueOrThrow({ where: { id }, include: { lineItems: { orderBy: { position: 'asc' } } } });
    // Resume after a partial failure instead of creating a second proforma.
    let proformaId = doc.convertedDocumentType === 'PROFORMA' ? doc.convertedDocumentId : null;
    let proformaNumber = doc.convertedDocumentNumber;
    if (!proformaId) {
      const pf = await createProforma(proformaPayload(doc, false));
      proformaId = pf.id; proformaNumber = pf.proformaNumber;
      await prisma.ocrDocument.update({ where: { id }, data: { convertedDocumentType: 'PROFORMA', convertedDocumentId: pf.id, convertedDocumentNumber: pf.proformaNumber } });
    }
    let finalType = 'PROFORMA', finalId = proformaId!, finalNumber = proformaNumber!;

    if (opts.destination === 'TAX_INVOICE') {
      const cur = await prisma.proforma.findUniqueOrThrow({ where: { id: proformaId! } });
      if (cur.status === 'DRAFT' || cur.status === 'SENT') await confirmProforma(proformaId!);
      const inv = await convertProformaToInvoice(proformaId!, opts.depotId);
      finalType = 'TAX_INVOICE'; finalId = inv.id; finalNumber = inv.invoiceNumber;
    }

    await prisma.ocrDocument.update({
      where: { id },
      data: { conversionStatus: 'CONVERTED', processingStatus: 'CONFIRMED', convertedDocumentType: finalType, convertedDocumentId: finalId, convertedDocumentNumber: finalNumber, convertedAt: new Date() },
    });
    await addEvent(id, 'CONVERSION_COMPLETED', `Converted to ${DESTINATIONS[opts.destination].label} ${finalNumber}`, user, { type: finalType, id: finalId });
    return { detail: await getDetail(id), link: finalType === 'TAX_INVOICE' ? `/invoices/${finalId}` : `/proformas/${finalId}`, number: finalNumber, type: finalType };
  } catch (e: any) {
    let msg = e instanceof ServiceError ? e.message : 'Conversion failed unexpectedly.';
    const partial = await prisma.ocrDocument.findUnique({ where: { id }, select: { convertedDocumentType: true, convertedDocumentNumber: true } });
    if (partial?.convertedDocumentType === 'PROFORMA' && opts.destination === 'TAX_INVOICE') {
      msg = msg.replace(' Nothing was changed; please try again.', '') + ` Proforma ${partial.convertedDocumentNumber} had already been created; retrying continues from it and will not create another.`;
    }
    if (!(e instanceof ServiceError)) console.error('[OCR convert] failed:', e?.message);
    await prisma.ocrDocument.update({ where: { id }, data: { conversionStatus: 'FAILED', failureReason: msg } });
    await addEvent(id, 'CONVERSION_FAILED', `Conversion failed: ${msg}`, user);
    throw new OcrModuleError(e instanceof ServiceError ? e.status : 500, msg);
  }
}
