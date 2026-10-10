import 'server-only';
import { prisma } from '@/lib/prisma';
import { dec, lineNet, round2, round4, sum2, taxOn } from '@/lib/money';
import { Actor, PurchasingError, companyCurrency, nextNumber, parseDate, postJournal, r2, refKey, writeAudit } from './common';

export const HEADS = { INVENTORY: 'acc-1300', INPUT_TAX: 'acc-1410', PAYABLE: 'acc-2100' };

interface LineInput { productId: string; quantity: number; unitCost: number; taxRate?: number; discountAmount?: number; taxAmount?: number }
interface HeaderDefaults { discountAmount: number; freightAmount: number; otherCharges: number }

async function validate(body: any, defaults: HeaderDefaults = { discountAmount: 0, freightAmount: 0, otherCharges: 0 }) {
  const supplierId = String(body.supplierId || '');
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
  if (!supplier) throw new PurchasingError(400, 'Select a supplier.');
  const supplierInvoiceNumber = String(body.supplierInvoiceNumber || '').trim().slice(0, 80);
  if (!supplierInvoiceNumber) throw new PurchasingError(400, 'Enter the supplier invoice number.');
  const invoiceDate = parseDate(body.invoiceDate, 'Invoice date');
  const depot = body.depotId ? await prisma.depot.findUnique({ where: { id: String(body.depotId) } }) : null;
  if (!depot) throw new PurchasingError(400, 'Select the receiving depot.');
  const raw: LineInput[] = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) throw new PurchasingError(400, 'Add at least one item.');
  const products = await prisma.product.findMany({ where: { id: { in: raw.map((l) => String(l.productId)) } } });
  const pmap = new Map(products.map((p) => [p.id, p]));
  const items = raw.map((l, i) => {
    const p = pmap.get(String(l.productId));
    if (!p) throw new PurchasingError(400, `Line ${i + 1}: product not found.`);
    const quantity = Number(l.quantity);
    const unitCost = Number(l.unitCost);
    const taxRate = Number(l.taxRate ?? 0);
    if (!Number.isInteger(quantity) || quantity < 1) throw new PurchasingError(400, `Line ${i + 1}: quantity must be a whole number of at least 1.`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new PurchasingError(400, `Line ${i + 1}: enter a valid unit cost.`);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new PurchasingError(400, `Line ${i + 1}: tax rate must be between 0 and 100.`);
    const discountAmount = Number(l.discountAmount ?? 0);
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || dec(discountAmount).greaterThan(dec(quantity).times(unitCost))) throw new PurchasingError(400, `Line ${i + 1}: the discount cannot be negative or more than quantity x unit cost.`);
    const base = lineNet(quantity, unitCost, discountAmount);
    let taxAmount = taxOn(base, taxRate);
    // A supplier who rounds tax once per invoice can differ from per-line rounding by a few cents: accept an explicit
    // line tax only within 5 cents of the computed one.
    if (l.taxAmount !== undefined && Number.isFinite(Number(l.taxAmount)) && dec(l.taxAmount).minus(taxAmount).abs().lessThanOrEqualTo(0.05)) taxAmount = round2(l.taxAmount);
    return { productId: p.id, productSku: p.sku, productName: p.name, quantity, unitCost, taxRate, taxAmount, discountAmount, lineTotal: base };
  });
  const amount = (v: unknown, fallback: number, label: string) => {
    const n = v === undefined || v === null || v === '' ? fallback : Number(v);
    if (!Number.isFinite(n) || n < 0) throw new PurchasingError(400, `${label} must be zero or a positive amount.`);
    return round2(n);
  };
  const discountAmount = amount(body.discountAmount, defaults.discountAmount, 'Invoice discount');
  const freightAmount = amount(body.freightAmount, defaults.freightAmount, 'Freight');
  const otherCharges = amount(body.otherCharges, defaults.otherCharges, 'Other charges');
  const subtotal = sum2(items.map((i) => i.lineTotal));
  const taxAmount = sum2(items.map((i) => i.taxAmount));
  const grandTotal = round2(dec(subtotal).minus(discountAmount).plus(taxAmount).plus(freightAmount).plus(otherCharges));
  if (grandTotal < 0) throw new PurchasingError(400, 'The invoice discount is larger than the invoice total.');
  return {
    supplier, depot, supplierInvoiceNumber, invoiceDate, items, subtotal, taxAmount, grandTotal, discountAmount, freightAmount, otherCharges,
    notes: String(body.notes || '').slice(0, 2000), currency: String(body.currency || '').trim().toUpperCase().slice(0, 3) || (await companyCurrency()),
  };
}

async function assertUniqueInvoice(supplierId: string, number: string, exceptId?: string) {
  const dup = await prisma.purchaseInvoice.findFirst({ where: { supplierId, supplierInvoiceKey: refKey(number), ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw new PurchasingError(409, `Supplier invoice ${number} is already recorded as ${dup.purchaseNumber}.`, { existingId: dup.id });
}

/** `ocrDocumentId` is set only by the OCR conversion (never from request bodies): one draft per scanned supplier invoice. */
export async function createPurchaseInvoice(body: any, actor: Actor, opts: { ocrDocumentId?: string } = {}) {
  const v = await validate(body);
  await assertUniqueInvoice(v.supplier.id, v.supplierInvoiceNumber);
  const inv = await prisma.$transaction(async (tx) => {
    const purchaseNumber = await nextNumber(tx, 'PURCHASE_INVOICE', 'PB-');
    return tx.purchaseInvoice.create({
      data: {
        purchaseNumber, supplierId: v.supplier.id, supplierName: v.supplier.name, supplierInvoiceNumber: v.supplierInvoiceNumber,
        supplierInvoiceKey: refKey(v.supplierInvoiceNumber), invoiceDate: v.invoiceDate, depotId: v.depot.id, depotName: v.depot.name,
        currency: v.currency, subtotal: v.subtotal, taxAmount: v.taxAmount, grandTotal: v.grandTotal, notes: v.notes,
        discountAmount: v.discountAmount, freightAmount: v.freightAmount, otherCharges: v.otherCharges, ocrDocumentId: opts.ocrDocumentId ?? null,
        createdById: actor.id, createdByName: actor.name, items: { create: v.items },
      },
      include: { items: true },
    });
  });
  await writeAudit(actor, { action: 'PURCHASE_INVOICE_CREATED', entityType: 'PURCHASE_INVOICE', entityId: inv.id, entityLabel: inv.purchaseNumber, description: `Draft purchase invoice ${inv.purchaseNumber} for ${inv.supplierName} (${inv.supplierInvoiceNumber}) created`, newValue: { grandTotal: inv.grandTotal } });
  return inv;
}

export async function updatePurchaseInvoice(id: string, body: any, actor: Actor) {
  const existing = await prisma.purchaseInvoice.findUnique({ where: { id } });
  if (!existing) throw new PurchasingError(404, 'Purchase invoice not found.');
  if (existing.status !== 'DRAFT') throw new PurchasingError(409, 'A posted purchase invoice cannot be changed. Record later supplier discounts as Supplier Price Support.');
  const v = await validate(body, { discountAmount: existing.discountAmount, freightAmount: existing.freightAmount, otherCharges: existing.otherCharges });
  await assertUniqueInvoice(v.supplier.id, v.supplierInvoiceNumber, id);
  const inv = await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: id } });
    return tx.purchaseInvoice.update({
      where: { id },
      data: {
        supplierId: v.supplier.id, supplierName: v.supplier.name, supplierInvoiceNumber: v.supplierInvoiceNumber, supplierInvoiceKey: refKey(v.supplierInvoiceNumber),
        invoiceDate: v.invoiceDate, depotId: v.depot.id, depotName: v.depot.name, currency: v.currency, subtotal: v.subtotal, taxAmount: v.taxAmount,
        grandTotal: v.grandTotal, notes: v.notes, discountAmount: v.discountAmount, freightAmount: v.freightAmount, otherCharges: v.otherCharges, items: { create: v.items },
      },
      include: { items: true },
    });
  });
  await writeAudit(actor, { action: 'PURCHASE_INVOICE_UPDATED', entityType: 'PURCHASE_INVOICE', entityId: id, entityLabel: inv.purchaseNumber, description: `Draft purchase invoice ${inv.purchaseNumber} updated`, previousValue: { grandTotal: existing.grandTotal }, newValue: { grandTotal: inv.grandTotal } });
  return inv;
}

/**
 * Posting receives the goods: stock in (DepotInventory + STOCK_IN ledger rows at the invoice cost), moving-average
 * product cost, and the purchase journal (Dr Inventory, Dr Input VAT / Cr Accounts Payable). After this the
 * invoice is immutable.
 */
export async function postPurchaseInvoice(id: string, actor: Actor) {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "PurchaseInvoice" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked.length) throw new PurchasingError(404, 'Purchase invoice not found.');
    if (locked[0].status !== 'DRAFT') throw new PurchasingError(409, 'This purchase invoice is already posted.');
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id }, include: { items: true } });

    // Stock is valued at landed cost: line cost net of line discount, plus a pro-rata share of the invoice-level
    // discount, freight and other charges. With none of those (every invoice before this change) it is simply qty x unit cost.
    const lineValue = inv.items.map((it) => dec(it.quantity).times(it.unitCost).minus(it.discountAmount));
    const baseSum = lineValue.reduce((s, x) => s.plus(x), dec(0));
    const unitsSum = inv.items.reduce((s, it) => s + it.quantity, 0);
    const adjust = dec(inv.freightAmount).plus(inv.otherCharges).minus(inv.discountAmount);
    const effective = inv.items.map((it, i) => {
      if (adjust.isZero()) return lineValue[i];
      const share = baseSum.greaterThan(0) ? lineValue[i].div(baseSum) : dec(it.quantity).div(unitsSum || 1);
      return lineValue[i].plus(adjust.times(share));
    });
    const unitCostOf = (i: number) => (adjust.isZero() && inv.items[i].discountAmount === 0 ? inv.items[i].unitCost : round4(effective[i].div(inv.items[i].quantity)));
    // aggregate per product so several lines of one product produce one cost update
    const perProduct = new Map<string, { qty: number; value: number }>();
    inv.items.forEach((it, i) => {
      const a = perProduct.get(it.productId) || { qty: 0, value: 0 };
      a.qty += it.quantity;
      a.value += effective[i].toNumber();
      perProduct.set(it.productId, a);
    });
    for (const [productId, a] of Array.from(perProduct.entries())) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const onHand = await tx.depotInventory.aggregate({ where: { productId }, _sum: { quantity: true } });
      const qtyBefore = Math.max(0, onHand._sum.quantity || 0);
      const newCost = qtyBefore + a.qty > 0 ? (qtyBefore * (product.purchasePrice || 0) + a.value) / (qtyBefore + a.qty) : product.purchasePrice;
      await tx.product.update({ where: { id: productId }, data: { purchasePrice: Math.round(newCost * 10000) / 10000 } });
    }
    for (let i = 0; i < inv.items.length; i++) {
      const it = inv.items[i];
      await tx.depotInventory.upsert({
        where: { productId_depotId: { productId: it.productId, depotId: inv.depotId } },
        update: { quantity: { increment: it.quantity }, availableQuantity: { increment: it.quantity } },
        create: { productId: it.productId, depotId: inv.depotId, quantity: it.quantity, availableQuantity: it.quantity },
      });
      await tx.stockTransaction.create({
        data: {
          type: 'STOCK_IN', productId: it.productId, productSku: it.productSku, productName: it.productName,
          targetDepotId: inv.depotId, targetDepotName: inv.depotName, quantity: it.quantity, unitCost: unitCostOf(i),
          referenceNumber: inv.purchaseNumber, notes: `Received against supplier invoice ${inv.supplierInvoiceNumber} (${inv.supplierName})`,
          createdBy: actor.name,
        },
      });
    }
    const journal = await postJournal(tx, {
      sourceType: 'PURCHASE_INVOICE', sourceId: inv.id, sourceRef: inv.purchaseNumber, date: inv.invoiceDate,
      narration: `Purchase ${inv.purchaseNumber} · ${inv.supplierName} invoice ${inv.supplierInvoiceNumber}`, actor,
      lines: [
        { headId: HEADS.INVENTORY, debit: round2(dec(inv.grandTotal).minus(inv.taxAmount)), description: 'Stock received at landed cost (net of discounts, plus freight and other charges)' },
        { headId: HEADS.INPUT_TAX, debit: inv.taxAmount, description: 'Input tax' },
        { headId: HEADS.PAYABLE, credit: inv.grandTotal, supplierId: inv.supplierId, description: `Payable to ${inv.supplierName}` },
      ],
    });
    return tx.purchaseInvoice.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), postedById: actor.id, postedByName: actor.name, journalEntryId: journal.id },
      include: { items: true },
    });
  });
  await writeAudit(actor, { action: 'PURCHASE_INVOICE_POSTED', entityType: 'PURCHASE_INVOICE', entityId: id, entityLabel: result.purchaseNumber, description: `Purchase invoice ${result.purchaseNumber} posted; ${result.items.reduce((s, i) => s + i.quantity, 0)} units received into ${result.depotName}`, newValue: { grandTotal: result.grandTotal, journalEntryId: result.journalEntryId } });
  return result;
}

export async function deleteDraftPurchaseInvoice(id: string, actor: Actor) {
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id } });
  if (!inv) throw new PurchasingError(404, 'Purchase invoice not found.');
  if (inv.status !== 'DRAFT') throw new PurchasingError(409, 'A posted purchase invoice cannot be deleted.');
  await prisma.$transaction(async (tx) => {
    // re-check inside the transaction: a draft that was posted a moment ago must not be deleted
    const cur = await tx.purchaseInvoice.findUnique({ where: { id }, select: { status: true } });
    if (!cur) return;
    if (cur.status !== 'DRAFT') throw new PurchasingError(409, 'A posted purchase invoice cannot be deleted.');
    await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: id } });
    await tx.purchaseInvoice.delete({ where: { id } });
  });
  await writeAudit(actor, { action: 'PURCHASE_INVOICE_DELETED', entityType: 'PURCHASE_INVOICE', entityId: id, entityLabel: inv.purchaseNumber, description: `Draft purchase invoice ${inv.purchaseNumber} deleted` });
}

/** Read-only summary of all price support linked to a purchase invoice. */
export async function supportSummaryFor(purchaseInvoiceId: string) {
  const entries = await prisma.supplierPriceSupport.findMany({
    where: { purchaseInvoiceId },
    orderBy: { supportDate: 'asc' },
    select: { id: true, supportNumber: true, supportReference: true, supportDate: true, amount: true, status: true, currency: true },
  });
  const posted = entries.filter((e) => e.status === 'POSTED');
  return {
    totalReceived: r2(posted.reduce((s, e) => s + e.amount, 0)),
    totalPendingOrApproved: r2(entries.filter((e) => e.status === 'PENDING_APPROVAL' || e.status === 'APPROVED' || e.status === 'DRAFT').reduce((s, e) => s + e.amount, 0)),
    count: entries.length,
    postedCount: posted.length,
    entries,
  };
}
