import { unitDecimals } from '@/lib/units';
import 'server-only';
import { prisma } from '@/lib/prisma';
import { addQty, formatQty, parseQty, qtyNum } from '@/lib/quantity';
import { dec, round2, round4 } from '@/lib/money';
import { calcLine, invoiceFinancials, summarize } from './calc';
import { Actor, PurchasingError, companyCurrency, ensureDefaultHeads, nextNumber, parseDate, postJournal, r2, refKey, writeAudit } from './common';

export const HEAD_CODES = { INVENTORY: '1300', INPUT_TAX: '1410', PAYABLE: '2100' };

interface LineInput { productId: string; quantity: number; unitCost: number; taxRate?: number; discountAmount?: number; taxAmount?: number }
interface HeaderDefaults { discountAmount: number; freightAmount: number; otherCharges: number; nonRecoverableVatPercent?: number; pricesIncludeTax?: boolean; exchangeRate?: number | null }

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
  const dpOf = await unitDecimals();
  const pricesIncludeTax = body.pricesIncludeTax === undefined ? !!defaults.pricesIncludeTax : body.pricesIncludeTax === true || body.pricesIncludeTax === 'true';
  const nrPct = Number(body.nonRecoverableVatPercent ?? defaults.nonRecoverableVatPercent ?? 0);
  if (!Number.isFinite(nrPct) || nrPct < 0 || nrPct > 100) throw new PurchasingError(400, 'Non-recoverable VAT must be between 0% and 100%.');
  const items = raw.map((l, i) => {
    const p = pmap.get(String(l.productId));
    if (!p) throw new PurchasingError(400, `Line ${i + 1}: product not found.`);
    const q = parseQty(l.quantity, { maxDecimals: dpOf(p.unit) });
    const quantity = q.value ?? NaN;
    const unitCost = Number(l.unitCost);
    const taxRate = Number(l.taxRate ?? 0);
    if (q.error) throw new PurchasingError(400, `Line ${i + 1}: ${q.error}`);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new PurchasingError(400, `Line ${i + 1}: enter a valid unit cost.`);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new PurchasingError(400, `Line ${i + 1}: tax rate must be between 0 and 100.`);
    const discountAmount = Number(l.discountAmount ?? 0);
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || dec(discountAmount).greaterThan(dec(quantity).times(unitCost))) throw new PurchasingError(400, `Line ${i + 1}: the discount cannot be negative or more than quantity x unit cost.`);
    // one calculation for the whole application (see ./calc): net, VAT and gross of the line
    const c = calcLine({ quantity, unitCost, taxRate, discountAmount, taxAmount: l.taxAmount }, pricesIncludeTax);
    if (c.net < 0) throw new PurchasingError(400, `Line ${i + 1}: the line amount cannot be negative.`);
    const base = c.net, taxAmount = c.tax;
    return { productId: p.id, productSku: p.sku, productName: p.name, quantity, unit: p.unit, unitCost, taxRate, taxAmount, discountAmount, lineTotal: base };
  });
  const amount = (v: unknown, fallback: number, label: string) => {
    const n = v === undefined || v === null || v === '' ? fallback : Number(v);
    if (!Number.isFinite(n) || n < 0) throw new PurchasingError(400, `${label} must be zero or a positive amount.`);
    return round2(n);
  };
  const discountAmount = amount(body.discountAmount, defaults.discountAmount, 'Invoice discount');
  const freightAmount = amount(body.freightAmount, defaults.freightAmount, 'Freight');
  const otherCharges = amount(body.otherCharges, defaults.otherCharges, 'Other charges');
  const fin = summarize(items.map((i) => ({ net: i.lineTotal, tax: i.taxAmount, taxRate: i.taxRate })), { discountAmount, freightAmount, otherCharges, pricesIncludeTax, nonRecoverableVatPercent: nrPct });
  const subtotal = fin.subtotal, taxAmount = fin.vat, grandTotal = fin.grandTotal;
  if (grandTotal < 0) throw new PurchasingError(400, 'The invoice discount is larger than the invoice total.');
  // Currency + exchange rate to the company's base currency. A foreign-currency draft may be saved without its rate
  // (e.g. straight from a scanned invoice); posting requires it, because stock cost is kept in the base currency.
  const base = await companyCurrency();
  const currency = String(body.currency || '').trim().toUpperCase().slice(0, 3) || base;
  if (!/^[A-Z]{3}$/.test(currency)) throw new PurchasingError(400, 'Currency must be a 3-letter ISO code (e.g. USD, AED).');
  let exchangeRate: number | null = 1;
  if (currency !== base) {
    const raw = body.exchangeRate !== undefined ? body.exchangeRate : defaults.exchangeRate;
    if (raw === undefined || raw === null || raw === '') exchangeRate = null;
    else {
      const r = Number(raw);
      if (!Number.isFinite(r) || r <= 0 || r > 1_000_000) throw new PurchasingError(400, `Enter a valid exchange rate: 1 ${currency} = how many ${base}.`);
      if (((String(raw).split('.')[1] || '').replace(/0+$/, '')).length > 6) throw new PurchasingError(400, 'The exchange rate can have at most 6 decimal places.');
      exchangeRate = r;
    }
  }
  return {
    supplier, depot, supplierInvoiceNumber, invoiceDate, items, subtotal, taxAmount, grandTotal, discountAmount, freightAmount, otherCharges, pricesIncludeTax, nonRecoverableVatPercent: nrPct,
    notes: String(body.notes || '').slice(0, 2000), currency, exchangeRate,
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
        discountAmount: v.discountAmount, freightAmount: v.freightAmount, otherCharges: v.otherCharges, pricesIncludeTax: v.pricesIncludeTax, nonRecoverableVatPercent: v.nonRecoverableVatPercent, exchangeRate: v.exchangeRate, ocrDocumentId: opts.ocrDocumentId ?? null,
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
  const v = await validate(body, { discountAmount: existing.discountAmount, freightAmount: existing.freightAmount, otherCharges: existing.otherCharges, nonRecoverableVatPercent: existing.nonRecoverableVatPercent, pricesIncludeTax: existing.pricesIncludeTax, exchangeRate: existing.exchangeRate == null ? null : Number(existing.exchangeRate) });
  await assertUniqueInvoice(v.supplier.id, v.supplierInvoiceNumber, id);
  const inv = await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: id } });
    return tx.purchaseInvoice.update({
      where: { id },
      data: {
        supplierId: v.supplier.id, supplierName: v.supplier.name, supplierInvoiceNumber: v.supplierInvoiceNumber, supplierInvoiceKey: refKey(v.supplierInvoiceNumber),
        invoiceDate: v.invoiceDate, depotId: v.depot.id, depotName: v.depot.name, currency: v.currency, subtotal: v.subtotal, taxAmount: v.taxAmount,
        grandTotal: v.grandTotal, notes: v.notes, discountAmount: v.discountAmount, freightAmount: v.freightAmount, otherCharges: v.otherCharges, pricesIncludeTax: v.pricesIncludeTax, nonRecoverableVatPercent: v.nonRecoverableVatPercent, exchangeRate: v.exchangeRate, items: { create: v.items },
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
  const ready = await postingReadiness(id);
  if (!ready.ready) throw new PurchasingError(409, `This invoice cannot be posted yet: ${ready.problems.join(' ')}`, { problems: ready.problems });
  const headMap = await ensureDefaultHeads([HEAD_CODES.INVENTORY, HEAD_CODES.INPUT_TAX, HEAD_CODES.PAYABLE]);
  const headOf = Object.fromEntries(Array.from(headMap.entries()).map(([c, h]) => [c, h])) as Record<string, { id: string }>;
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "PurchaseInvoice" WHERE "id" = ${id} FOR UPDATE`;
    if (!locked.length) throw new PurchasingError(404, 'Purchase invoice not found.');
    if (locked[0].status !== 'DRAFT') throw new PurchasingError(409, 'This purchase invoice is already posted.');
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id }, include: { items: true } });

    // The same calculation as the form and the confirmation (./calc), on the SAVED lines. Stock is valued at landed cost:
    // line net + pro-rata invoice discount / freight / other charges + the non-recoverable share of VAT (allocated by
    // each line's VAT). Recoverable VAT is a tax receivable and never part of stock cost.
    const fin = invoiceFinancials(inv);
    const recomputed = summarize(inv.items.map((it) => ({ net: it.lineTotal, tax: it.taxAmount, taxRate: it.taxRate })), { pricesIncludeTax: inv.pricesIncludeTax });
    if (Math.abs(recomputed.vat - inv.taxAmount) > 0.05 || Math.abs(fin.grandTotal - inv.grandTotal) > 0.01) {
      throw new PurchasingError(409, `The saved totals of ${inv.purchaseNumber} do not match its lines (saved total ${inv.grandTotal.toFixed(2)}, lines give ${fin.grandTotal.toFixed(2)}). Open the draft and save it again before posting.`);
    }
    const lineValue = inv.items.map((it) => dec(it.lineTotal));
    const baseSum = lineValue.reduce((s, x) => s.plus(x), dec(0));
    const unitsSum = addQty(...inv.items.map((it) => it.quantity));
    const adjust = dec(inv.freightAmount).plus(inv.otherCharges).minus(inv.discountAmount);
    const taxSum = inv.items.reduce((s, it) => s.plus(it.taxAmount), dec(0));
    const nonRec = dec(fin.nonRecoverableVat);
    const effective = inv.items.map((it, i) => {
      const share = baseSum.greaterThan(0) ? lineValue[i].div(baseSum) : dec(it.quantity).div(unitsSum || 1);
      const nrShare = taxSum.greaterThan(0) ? dec(it.taxAmount).div(taxSum) : share;
      return lineValue[i].plus(adjust.times(share)).plus(nonRec.times(nrShare));
    });
    const plain = adjust.isZero() && nonRec.isZero() && !inv.pricesIncludeTax;
    // Stock cost, the product's moving average and the journal are in the company's base currency.
    const base = await companyCurrency();
    const rate = inv.currency === base ? 1 : Number(inv.exchangeRate);
    if (!(rate > 0)) throw new PurchasingError(409, `Enter the exchange rate (1 ${inv.currency} = ? ${base}) on the draft before posting.`);
    // unit cost in the base currency, rounded once (4 places)
    const unitCostOf = (i: number) => (plain && inv.items[i].discountAmount === 0 && Math.abs(dec(inv.items[i].quantity).times(inv.items[i].unitCost).minus(inv.items[i].lineTotal).toNumber()) < 0.005
      ? round4(dec(inv.items[i].unitCost).times(rate))
      : round4(effective[i].times(rate).div(inv.items[i].quantity)));
    // aggregate per product so several lines of one product produce one cost update
    const perProduct = new Map<string, { qty: number; value: number }>();
    inv.items.forEach((it, i) => {
      const a = perProduct.get(it.productId) || { qty: 0, value: 0 };
      a.qty = addQty(a.qty, it.quantity);
      a.value += effective[i].times(rate).toNumber();
      perProduct.set(it.productId, a);
    });
    // Few round trips on purpose: the posting runs in one transaction and the database can be far from the server.
    const productIds = Array.from(perProduct.keys());
    const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, purchasePrice: true } });
    const pmap = new Map(products.map((p) => [p.id, p]));
    const onHandRows = await tx.depotInventory.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _sum: { quantity: true } });
    const onHandOf = new Map(onHandRows.map((r) => [r.productId, qtyNum(r._sum.quantity)]));
    for (const [productId, a] of Array.from(perProduct.entries())) {
      const product = pmap.get(productId);
      if (!product) throw new PurchasingError(409, `A product on this invoice no longer exists (${inv.items.find((i) => i.productId === productId)?.productName || productId}). Open the draft and replace the line.`);
      const before = onHandOf.get(productId) ?? 0;
      const qtyBefore = Math.max(0, before);
      const newCost = qtyBefore + a.qty > 0 ? (qtyBefore * (product.purchasePrice || 0) + a.value) / (qtyBefore + a.qty) : product.purchasePrice;
      // purchase cost (moving average) and the denormalised stock total in one update
      await tx.product.update({ where: { id: productId }, data: { purchasePrice: Math.round(newCost * 10000) / 10000, totalStock: addQty(before, a.qty) } });
      await tx.depotInventory.upsert({
        where: { productId_depotId: { productId, depotId: inv.depotId } },
        update: { quantity: { increment: a.qty }, availableQuantity: { increment: a.qty } },
        create: { productId, depotId: inv.depotId, quantity: a.qty, availableQuantity: a.qty },
      });
    }
    await tx.stockTransaction.createMany({
      data: inv.items.map((it, i) => ({
        type: 'STOCK_IN' as const, productId: it.productId, productSku: it.productSku, productName: it.productName,
        targetDepotId: inv.depotId, targetDepotName: inv.depotName, quantity: it.quantity, unitCost: unitCostOf(i),
        referenceNumber: inv.purchaseNumber, notes: `Received against supplier invoice ${inv.supplierInvoiceNumber} (${inv.supplierName})`,
        createdBy: actor.name,
      })),
    });
    // Journal in the base currency; the input-VAT line takes the rounding so the entry balances exactly.
    const jPayable = round2(dec(fin.grandTotal).times(rate));
    const jInputVat = round2(dec(fin.recoverableVat).times(rate));
    const jInventory = round2(dec(jPayable).minus(jInputVat));
    const journal = await postJournal(tx, {
      sourceType: 'PURCHASE_INVOICE', sourceId: inv.id, sourceRef: inv.purchaseNumber, date: inv.invoiceDate,
      narration: `Purchase ${inv.purchaseNumber} · ${inv.supplierName} invoice ${inv.supplierInvoiceNumber}`, actor,
      lines: [
        { headId: headOf[HEAD_CODES.INVENTORY].id, debit: jInventory, description: nonRec.isZero() ? 'Stock received at landed cost (net of discounts, plus freight and other charges)' : 'Stock received at landed cost (net of discounts, plus freight, other charges and non-recoverable VAT)' },
        { headId: headOf[HEAD_CODES.INPUT_TAX].id, debit: jInputVat, description: 'Recoverable input VAT' },
        { headId: headOf[HEAD_CODES.PAYABLE].id, credit: jPayable, supplierId: inv.supplierId, description: `Payable to ${inv.supplierName}${rate !== 1 ? ` (${inv.currency} ${fin.grandTotal.toFixed(2)} @ ${rate})` : ''}` },
      ],
    });
    return tx.purchaseInvoice.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), postedById: actor.id, postedByName: actor.name, journalEntryId: journal.id },
      include: { items: true },
    });
  });
  await writeAudit(actor, { action: 'PURCHASE_INVOICE_POSTED', entityType: 'PURCHASE_INVOICE', entityId: id, entityLabel: result.purchaseNumber, description: `Purchase invoice ${result.purchaseNumber} posted; ${formatQty(addQty(...result.items.map((i) => i.quantity)))} units received into ${result.depotName}`, newValue: { grandTotal: result.grandTotal, journalEntryId: result.journalEntryId } });
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
/**
 * Everything posting needs, checked WITHOUT changing anything. Used by the confirmation dialog and as the first thing posting
 * itself runs through, so a missing accounting head, an inactive depot or stale totals are named before anything is attempted.
 */
export async function postingReadiness(id: string) {
  const problems: string[] = [];
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { items: true } });
  if (!inv) throw new PurchasingError(404, 'Purchase invoice not found.');
  if (inv.status !== 'DRAFT') problems.push('This purchase invoice is already posted.');
  if (!inv.items.length) problems.push('The invoice has no lines.');
  const fin = invoiceFinancials(inv);
  const recomputed = summarize(inv.items.map((it) => ({ net: it.lineTotal, tax: it.taxAmount, taxRate: it.taxRate })), { pricesIncludeTax: inv.pricesIncludeTax });
  if (Math.abs(recomputed.vat - inv.taxAmount) > 0.05 || Math.abs(fin.grandTotal - inv.grandTotal) > 0.01) problems.push(`The saved totals do not match the lines (saved total ${inv.grandTotal.toFixed(2)}, lines give ${fin.grandTotal.toFixed(2)}). Open the draft and save it again.`);
  const [depot, products, journal, supplier] = await Promise.all([
    prisma.depot.findUnique({ where: { id: inv.depotId }, select: { name: true, status: true } }),
    prisma.product.findMany({ where: { id: { in: inv.items.map((i) => i.productId) } }, select: { id: true } }),
    prisma.journalEntry.findFirst({ where: { sourceType: 'PURCHASE_INVOICE', sourceId: id }, select: { entryNumber: true } }),
    prisma.supplier.findUnique({ where: { id: inv.supplierId }, select: { id: true } }),
  ]);
  if (!supplier) problems.push('The supplier no longer exists.');
  if (!depot) problems.push('The receiving depot no longer exists.');
  else if (depot.status !== 'ACTIVE') problems.push(`The receiving depot ${depot.name} is not active.`);
  const have = new Set(products.map((p) => p.id));
  for (const it of inv.items) if (!have.has(it.productId)) problems.push(`Product ${it.productName} (${it.productSku}) no longer exists.`);
  // Missing default accounts are restored when posting (see ensureDefaultHeads); an existing but inactive one blocks.
  const hs = await prisma.accountingHead.findMany({ where: { code: { in: [HEAD_CODES.INVENTORY, HEAD_CODES.INPUT_TAX, HEAD_CODES.PAYABLE] } }, select: { code: true, isActive: true, name: true } });
  for (const [code, label, needed] of [[HEAD_CODES.INVENTORY, 'Inventory', true], [HEAD_CODES.PAYABLE, 'Accounts Payable', true], [HEAD_CODES.INPUT_TAX, 'Input VAT', fin.recoverableVat > 0]] as [string, string, boolean][]) {
    const h = hs.find((x) => x.code === code);
    if (needed && h && !h.isActive) problems.push(`The accounting head ${label} (${code}) is inactive. Activate it under Accounting.`);
  }
  const baseCur = await companyCurrency();
  if (inv.currency !== baseCur && !(Number(inv.exchangeRate) > 0)) problems.push(`This invoice is in ${inv.currency}; enter the exchange rate to ${baseCur} on the draft (stock is valued in ${baseCur}).`);
  if (journal) problems.push(`An accounting entry (${journal.entryNumber}) already exists for this invoice.`);
  return { ready: problems.length === 0, problems, financials: fin };
}

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
