import 'server-only';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/rbac';
import { Actor, PurchasingError, Tx, nextNumber, parseDate, postJournal, r2, refKey, writeAudit } from './common';

/**
 * Supplier Price Support: a post-purchase discount / rebate recorded as its own transaction, linked to the original
 * POSTED purchase invoice. It never touches the purchase invoice, product cost, stock quantities or the stock ledger.
 * Accounting on posting: Dr <settlement head> (default Accounts Payable) / Cr <support head> (default Price Support Received).
 */
export const DEFAULT_CREDIT_HEAD = 'acc-4510';
export const DEFAULT_SETTLEMENT_HEAD = 'acc-2100';
export const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'] as const;
const EDITABLE = new Set(['DRAFT', 'REJECTED']);

async function addEvent(tx: Tx, supportId: string, action: string, from: string | null, to: string | null, actor: Actor, note = '') {
  await tx.supplierPriceSupportEvent.create({ data: { supportId, action, fromStatus: from, toStatus: to, note: note.slice(0, 1000), userId: actor.id, userName: actor.name } });
}

async function validate(body: any, exceptId?: string) {
  const supplierId = String(body.supplierId || '');
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
  if (!supplier) throw new PurchasingError(400, 'Select a supplier.');

  const invoice = body.purchaseInvoiceId ? await prisma.purchaseInvoice.findUnique({ where: { id: String(body.purchaseInvoiceId) } }) : null;
  if (!invoice) throw new PurchasingError(400, 'Select the original supplier invoice.');
  if (invoice.supplierId !== supplier.id) throw new PurchasingError(400, 'The selected invoice belongs to a different supplier.');
  if (invoice.status !== 'POSTED') throw new PurchasingError(400, 'Price support can only be linked to a posted supplier invoice.');

  const supportReference = String(body.supportReference || '').trim().slice(0, 80);
  if (!supportReference) throw new PurchasingError(400, 'Enter the support reference number (e.g. the supplier credit note number).');
  const dup = await prisma.supplierPriceSupport.findFirst({ where: { supplierId: supplier.id, supportReferenceKey: refKey(supportReference), ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw new PurchasingError(409, `Support reference ${supportReference} is already recorded for ${supplier.name} as ${dup.supportNumber}.`, { existingId: dup.id, code: 'duplicate_reference' });

  const supportDate = parseDate(body.supportDate, 'Support date');
  const dayOnly = (d: Date) => d.toISOString().slice(0, 10);
  if (dayOnly(supportDate) < dayOnly(invoice.invoiceDate)) throw new PurchasingError(400, 'Support date cannot be before the original invoice date.');
  if (supportDate.getTime() > Date.now() + 86400000) throw new PurchasingError(400, 'Support date cannot be in the future.');

  const amount = r2(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new PurchasingError(400, 'Support amount must be greater than zero.');
  const others = await prisma.supplierPriceSupport.aggregate({
    where: { purchaseInvoiceId: invoice.id, status: { not: 'REJECTED' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { amount: true },
  });
  const remaining = r2(invoice.grandTotal - (others._sum.amount || 0));
  if (amount > remaining) throw new PurchasingError(400, `Support exceeds what is left on invoice ${invoice.supplierInvoiceNumber}: at most ${remaining.toFixed(2)} ${invoice.currency} can still be recorded.`);

  const reason = String(body.reason || '').trim().slice(0, 2000);
  if (reason.length < 3) throw new PurchasingError(400, 'Enter the reason / remarks for this support.');

  const accountingHeadId = String(body.accountingHeadId || DEFAULT_CREDIT_HEAD);
  const settlementHeadId = String(body.settlementHeadId || DEFAULT_SETTLEMENT_HEAD);
  const heads = await prisma.accountingHead.findMany({ where: { id: { in: [accountingHeadId, settlementHeadId] }, isActive: true } });
  const credit = heads.find((h) => h.id === accountingHeadId);
  const settle = heads.find((h) => h.id === settlementHeadId);
  if (!credit || !credit.usage.split(',').includes('PRICE_SUPPORT_CREDIT')) throw new PurchasingError(400, 'Choose a valid accounting head for the support.');
  if (!settle || !settle.usage.split(',').includes('PRICE_SUPPORT_SETTLEMENT')) throw new PurchasingError(400, 'Choose how the support is settled (payable or receivable).');

  return { supplier, invoice, supportReference, supportDate, amount, reason, accountingHeadId, settlementHeadId };
}

export async function createSupport(body: any, actor: Actor) {
  const v = await validate(body);
  const created = await prisma.$transaction(async (tx) => {
    const supportNumber = await nextNumber(tx, 'PRICE_SUPPORT', 'SPS-');
    const s = await tx.supplierPriceSupport.create({
      data: {
        supportNumber, supplierId: v.supplier.id, supplierName: v.supplier.name, supportReference: v.supportReference, supportReferenceKey: refKey(v.supportReference),
        purchaseInvoiceId: v.invoice.id, originalInvoiceNumber: v.invoice.supplierInvoiceNumber, purchaseNumber: v.invoice.purchaseNumber,
        invoiceDate: v.invoice.invoiceDate, supportDate: v.supportDate, amount: v.amount, currency: v.invoice.currency, reason: v.reason,
        accountingHeadId: v.accountingHeadId, settlementHeadId: v.settlementHeadId, createdById: actor.id, createdByName: actor.name,
      },
    });
    await addEvent(tx, s.id, 'CREATED', null, 'DRAFT', actor, `Amount ${v.amount.toFixed(2)} ${v.invoice.currency}`);
    return s;
  });
  await writeAudit(actor, { action: 'PRICE_SUPPORT_CREATED', entityType: 'SUPPLIER_PRICE_SUPPORT', entityId: created.id, entityLabel: created.supportNumber, description: `${created.supportNumber}: ${created.amount.toFixed(2)} ${created.currency} support from ${created.supplierName} against invoice ${created.originalInvoiceNumber}`, newValue: { amount: created.amount, purchaseInvoiceId: created.purchaseInvoiceId, reference: created.supportReference } });
  return created;
}

export async function updateSupport(id: string, body: any, actor: Actor) {
  const existing = await prisma.supplierPriceSupport.findUnique({ where: { id } });
  if (!existing) throw new PurchasingError(404, 'Price support entry not found.');
  if (!EDITABLE.has(existing.status)) throw new PurchasingError(409, `Only draft or rejected entries can be edited (this one is ${existing.status.replace('_', ' ').toLowerCase()}).`);
  const v = await validate(body, id);
  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.supplierPriceSupport.update({
      where: { id },
      data: {
        supplierId: v.supplier.id, supplierName: v.supplier.name, supportReference: v.supportReference, supportReferenceKey: refKey(v.supportReference),
        purchaseInvoiceId: v.invoice.id, originalInvoiceNumber: v.invoice.supplierInvoiceNumber, purchaseNumber: v.invoice.purchaseNumber,
        invoiceDate: v.invoice.invoiceDate, supportDate: v.supportDate, amount: v.amount, currency: v.invoice.currency, reason: v.reason,
        accountingHeadId: v.accountingHeadId, settlementHeadId: v.settlementHeadId,
        // editing a rejected entry returns it to draft
        status: 'DRAFT', rejectedAt: null, rejectedById: null, rejectedByName: null, rejectionReason: existing.status === 'REJECTED' ? existing.rejectionReason : null,
      },
    });
    await addEvent(tx, id, 'EDITED', existing.status, 'DRAFT', actor, existing.amount !== v.amount ? `Amount ${existing.amount.toFixed(2)} → ${v.amount.toFixed(2)}` : '');
    return s;
  });
  await writeAudit(actor, { action: 'PRICE_SUPPORT_EDITED', entityType: 'SUPPLIER_PRICE_SUPPORT', entityId: id, entityLabel: updated.supportNumber, description: `${updated.supportNumber} edited`, previousValue: { amount: existing.amount, reference: existing.supportReference, status: existing.status }, newValue: { amount: updated.amount, reference: updated.supportReference, status: updated.status } });
  return updated;
}

type Action = 'submit' | 'approve' | 'reject' | 'post';

export async function transitionSupport(id: string, action: Action, actor: Actor, note = '') {
  if ((action === 'approve' || action === 'reject' || action === 'post') && !hasPermission(actor.role, 'price_support.approve')) {
    throw new PurchasingError(403, 'You do not have permission to approve, reject or post price support.');
  }
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "SupplierPriceSupport" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked.length) throw new PurchasingError(404, 'Price support entry not found.');
    const s = await tx.supplierPriceSupport.findUniqueOrThrow({ where: { id } });
    const from = s.status;
    const need = (allowed: string[]) => {
      if (!allowed.includes(from)) throw new PurchasingError(409, `Cannot ${action} an entry that is ${from.replace('_', ' ').toLowerCase()}.`);
    };
    const now = new Date();
    if (action === 'submit') {
      need(['DRAFT']);
      const u = await tx.supplierPriceSupport.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: now } });
      await addEvent(tx, id, 'SUBMITTED', from, u.status, actor, note);
      return u;
    }
    if (action === 'approve') {
      need(['PENDING_APPROVAL']);
      // segregation of duties: the creator cannot approve their own entry (Super Admin excepted)
      if (s.createdById === actor.id && actor.role !== 'SUPER_ADMIN') throw new PurchasingError(403, 'You cannot approve a price support entry you created.');
      const u = await tx.supplierPriceSupport.update({ where: { id }, data: { status: 'APPROVED', approvedAt: now, approvedById: actor.id, approvedByName: actor.name } });
      await addEvent(tx, id, 'APPROVED', from, u.status, actor, note);
      return u;
    }
    if (action === 'reject') {
      need(['PENDING_APPROVAL', 'APPROVED']);
      if (note.trim().length < 3) throw new PurchasingError(400, 'Give a reason for rejecting.');
      const u = await tx.supplierPriceSupport.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: now, rejectedById: actor.id, rejectedByName: actor.name, rejectionReason: note.trim().slice(0, 1000) } });
      await addEvent(tx, id, 'REJECTED', from, u.status, actor, note);
      return u;
    }
    // post
    need(['APPROVED']);
    const invoice = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: s.purchaseInvoiceId } });
    if (invoice.status !== 'POSTED') throw new PurchasingError(409, 'The original invoice is not posted.');
    const journal = await postJournal(tx, {
      sourceType: 'SUPPLIER_PRICE_SUPPORT', sourceId: s.id, sourceRef: s.supportNumber, date: s.supportDate,
      narration: `Supplier price support ${s.supportNumber} (${s.supportReference}) from ${s.supplierName} against invoice ${s.originalInvoiceNumber} / ${s.purchaseNumber}`,
      actor,
      lines: [
        { headId: s.settlementHeadId, debit: s.amount, supplierId: s.supplierId, description: `Price support ${s.supportReference}` },
        { headId: s.accountingHeadId, credit: s.amount, supplierId: s.supplierId, description: s.reason.slice(0, 200) },
      ],
    });
    const u = await tx.supplierPriceSupport.update({ where: { id }, data: { status: 'POSTED', postedAt: now, postedById: actor.id, postedByName: actor.name, journalEntryId: journal.id } });
    await addEvent(tx, id, 'POSTED', from, u.status, actor, `Journal ${journal.entryNumber}`);
    return u;
  });
  await writeAudit(actor, {
    action: `PRICE_SUPPORT_${({ submit: 'SUBMITTED', approve: 'APPROVED', reject: 'REJECTED', post: 'POSTED' } as const)[action]}`,
    entityType: 'SUPPLIER_PRICE_SUPPORT', entityId: id, entityLabel: result.supportNumber,
    description: `${result.supportNumber} ${result.status.replace('_', ' ').toLowerCase()}${note ? `: ${note}` : ''}`, newValue: { status: result.status, amount: result.amount },
  });
  return result;
}

export async function setAttachment(id: string, file: { name: string; type: string; provider: string; key: string }, actor: Actor) {
  const s = await prisma.supplierPriceSupport.findUnique({ where: { id } });
  if (!s) throw new PurchasingError(404, 'Price support entry not found.');
  if (s.status === 'POSTED') throw new PurchasingError(409, 'A posted entry cannot be changed.');
  const u = await prisma.$transaction(async (tx) => {
    const r = await tx.supplierPriceSupport.update({ where: { id }, data: { attachmentName: file.name, attachmentType: file.type, attachmentProvider: file.provider, attachmentKey: file.key } });
    await addEvent(tx, id, 'ATTACHMENT', s.status, s.status, actor, file.name);
    return r;
  });
  await writeAudit(actor, { action: 'PRICE_SUPPORT_ATTACHMENT', entityType: 'SUPPLIER_PRICE_SUPPORT', entityId: id, entityLabel: s.supportNumber, description: `Supporting document ${file.name} attached to ${s.supportNumber}` });
  return u;
}

export async function getSupport(id: string) {
  const s = await prisma.supplierPriceSupport.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      accountingHead: { select: { id: true, code: true, name: true } },
      settlementHead: { select: { id: true, code: true, name: true } },
      purchaseInvoice: { select: { id: true, purchaseNumber: true, supplierInvoiceNumber: true, invoiceDate: true, grandTotal: true, subtotal: true, taxAmount: true, currency: true, depotName: true, status: true, postedAt: true } },
    },
  });
  if (!s) throw new PurchasingError(404, 'Price support entry not found.');
  const journal = s.journalEntryId ? await prisma.journalEntry.findUnique({ where: { id: s.journalEntryId }, include: { lines: true } }) : null;
  return { ...s, journal };
}

export function listWhere(q: { supplierId?: string; status?: string; from?: string; to?: string; purchaseInvoiceId?: string; q?: string }) {
  const where: any = {};
  if (q.supplierId) where.supplierId = q.supplierId;
  if (q.purchaseInvoiceId) where.purchaseInvoiceId = q.purchaseInvoiceId;
  if (q.status && (STATUSES as readonly string[]).includes(q.status)) where.status = q.status;
  if (q.from || q.to) {
    where.supportDate = {};
    if (q.from) where.supportDate.gte = parseDate(q.from, 'From');
    if (q.to) where.supportDate.lte = new Date(parseDate(q.to, 'To').getTime() + 86399999);
  }
  if (q.q) {
    const t = q.q.trim();
    where.OR = [
      { supportNumber: { contains: t, mode: 'insensitive' } },
      { supportReference: { contains: t, mode: 'insensitive' } },
      { originalInvoiceNumber: { contains: t, mode: 'insensitive' } },
      { purchaseNumber: { contains: t, mode: 'insensitive' } },
      { supplierName: { contains: t, mode: 'insensitive' } },
    ];
  }
  return where;
}

export async function supportReport(q: Parameters<typeof listWhere>[0]) {
  const rows = await prisma.supplierPriceSupport.findMany({ where: listWhere(q), orderBy: { supportDate: 'asc' } });
  const sum = (xs: typeof rows) => r2(xs.reduce((s, x) => s + x.amount, 0));
  const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, typeof rows>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) || []), r]);
    return m;
  };
  const statusSummary = (['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED'] as const).map((st) => {
    const xs = rows.filter((r) => r.status === st);
    return { status: st, count: xs.length, amount: sum(xs) };
  });
  const bySupplier = Array.from(group((r) => r.supplierId).values()).map((xs) => ({
    supplierId: xs[0].supplierId, supplierName: xs[0].supplierName, count: xs.length,
    posted: sum(xs.filter((x) => x.status === 'POSTED')),
    pending: sum(xs.filter((x) => x.status === 'PENDING_APPROVAL' || x.status === 'APPROVED' || x.status === 'DRAFT')),
    total: sum(xs.filter((x) => x.status !== 'REJECTED')),
  })).sort((a, b) => b.posted - a.posted);
  const byInvoice = Array.from(group((r) => r.purchaseInvoiceId).values()).map((xs) => ({
    purchaseInvoiceId: xs[0].purchaseInvoiceId, purchaseNumber: xs[0].purchaseNumber, originalInvoiceNumber: xs[0].originalInvoiceNumber,
    supplierName: xs[0].supplierName, invoiceDate: xs[0].invoiceDate, count: xs.length, posted: sum(xs.filter((x) => x.status === 'POSTED')),
    entries: xs.map((x) => ({ id: x.id, supportNumber: x.supportNumber, supportReference: x.supportReference, supportDate: x.supportDate, amount: x.amount, status: x.status })),
  }));
  const byDate = Array.from(group((r) => r.supportDate.toISOString().slice(0, 10)).entries()).map(([date, xs]) => ({
    date, count: xs.length, posted: sum(xs.filter((x) => x.status === 'POSTED')), total: sum(xs.filter((x) => x.status !== 'REJECTED')),
  })).sort((a, b) => a.date.localeCompare(b.date));
  return { rows, statusSummary, bySupplier, byInvoice, byDate, totals: { posted: sum(rows.filter((r) => r.status === 'POSTED')), all: sum(rows.filter((r) => r.status !== 'REJECTED')), count: rows.length } };
}
