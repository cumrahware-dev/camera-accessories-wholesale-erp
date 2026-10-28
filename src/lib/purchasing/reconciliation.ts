import 'server-only';
import { prisma } from '@/lib/prisma';
import { addQty, qtyNum, subQty } from '@/lib/quantity';
import { dec, round4 } from '@/lib/money';
import { Actor, PurchasingError, companyCurrency, writeAudit } from './common';

/**
 * Posted purchase invoices against what they actually put into stock. Read-only: compares every posted line with the
 * STOCK_IN movements carrying the invoice's number, the depot rows and the product totals, and says what is wrong.
 *
 *   OK            movement(s) for the line's product exist, at the invoice depot, for exactly the posted quantity
 *   MISSING       no movement at all for the product: the stock never arrived (repairable)
 *   QTY_MISMATCH  movements exist but add up to a different quantity (reported, never auto-repaired)
 *   WRONG_DEPOT   a movement went to another depot (reported)
 *   NO_PRODUCT    the product of the line no longer exists (reported)
 * Invoice level: NO_JOURNAL (posted without its accounting entry), FOREIGN_NO_RATE (posted in another currency before
 * exchange rates existed: its stock cost was booked in that currency unconverted).
 * Product level: TOTAL_STALE (stored product total differs from its depot rows: derived, repairable), NO_COST (stock with
 * purchase cost 0), NO_WHOLESALE_PRICE (informational: the inventory screen's wholesale value is 0 because no price is set).
 */
export interface ReconLine { lineId: string; productId: string; sku: string; name: string; unit: string; postedQty: number; movedQty: number; movements: number; unitCost: number; status: 'OK' | 'MISSING' | 'QTY_MISMATCH' | 'WRONG_DEPOT' | 'NO_PRODUCT'; depotQtyNow: number | null }
export interface ReconInvoice { id: string; purchaseNumber: string; supplierName: string; supplierInvoiceNumber: string; depotId: string; depotName: string; currency: string; exchangeRate: number | null; postedAt: string | null; lines: ReconLine[]; issues: string[]; repairable: boolean }
export interface ReconProduct { productId: string; sku: string; name: string; unit: string; storedTotal: number; depotTotal: number; purchasePrice: number; wholesalePrice: number; costValue: number; issues: string[] }

export async function reconcilePurchases(opts: { days?: number; invoiceIds?: string[] } = {}) {
  const base = await companyCurrency();
  const since = new Date(Date.now() - Math.max(1, Math.min(3650, opts.days ?? 30)) * 86400000);
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { status: 'POSTED', ...(opts.invoiceIds?.length ? { id: { in: opts.invoiceIds } } : { postedAt: { gte: since } }) },
    include: { items: true },
    orderBy: { postedAt: 'desc' },
  });
  const refs = invoices.map((i) => i.purchaseNumber);
  const productIds = Array.from(new Set(invoices.flatMap((i) => i.items.map((it) => it.productId))));
  const [moves, products, depotRows, journals] = await Promise.all([
    prisma.stockTransaction.findMany({ where: { type: 'STOCK_IN', referenceNumber: { in: refs } }, select: { productId: true, referenceNumber: true, quantity: true, targetDepotId: true, notes: true } }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true, unit: true, totalStock: true, purchasePrice: true, wholesalePrice: true } }),
    prisma.depotInventory.findMany({ where: { productId: { in: productIds } }, select: { productId: true, depotId: true, quantity: true } }),
    prisma.journalEntry.findMany({ where: { sourceType: 'PURCHASE_INVOICE', sourceId: { in: invoices.map((i) => i.id) } }, select: { sourceId: true } }),
  ]);
  const pmap = new Map(products.map((p) => [p.id, p]));
  const withJournal = new Set(journals.map((j) => j.sourceId));

  const out: ReconInvoice[] = invoices.map((inv) => {
    const issues: string[] = [];
    if (!withJournal.has(inv.id)) issues.push('NO_JOURNAL');
    if (inv.currency !== base && !(Number(inv.exchangeRate) > 0)) issues.push('FOREIGN_NO_RATE');
    // several lines of one product share their movements: compare per product
    const byProduct = new Map<string, number>();
    inv.items.forEach((it) => byProduct.set(it.productId, addQty(byProduct.get(it.productId) ?? 0, it.quantity)));
    const lines: ReconLine[] = inv.items.map((it) => {
      const p = pmap.get(it.productId);
      const mv = moves.filter((m) => m.referenceNumber === inv.purchaseNumber && m.productId === it.productId);
      const movedQty = addQty(...mv.map((m) => m.quantity));
      const expected = byProduct.get(it.productId) ?? 0;
      let status: ReconLine['status'] = 'OK';
      if (!p) status = 'NO_PRODUCT';
      else if (!mv.length) status = 'MISSING';
      else if (mv.some((m) => m.targetDepotId !== inv.depotId)) status = 'WRONG_DEPOT';
      else if (Math.abs(subQty(movedQty, expected)) > 0.0005) status = 'QTY_MISMATCH';
      const depotQtyNow = depotRows.find((r) => r.productId === it.productId && r.depotId === inv.depotId);
      return { lineId: it.id, productId: it.productId, sku: it.productSku, name: it.productName, unit: it.unit, postedQty: qtyNum(it.quantity), movedQty, movements: mv.length, unitCost: it.unitCost, status, depotQtyNow: depotQtyNow ? qtyNum(depotQtyNow.quantity) : null };
    });
    for (const st of ['MISSING', 'QTY_MISMATCH', 'WRONG_DEPOT', 'NO_PRODUCT'] as const) if (lines.some((l) => l.status === st)) issues.push(`LINE_${st}`);
    return { id: inv.id, purchaseNumber: inv.purchaseNumber, supplierName: inv.supplierName, supplierInvoiceNumber: inv.supplierInvoiceNumber, depotId: inv.depotId, depotName: inv.depotName, currency: inv.currency, exchangeRate: inv.exchangeRate == null ? null : Number(inv.exchangeRate), postedAt: inv.postedAt ? inv.postedAt.toISOString() : null, lines, issues, repairable: lines.some((l) => l.status === 'MISSING') };
  });

  const productsOut: ReconProduct[] = products.map((p) => {
    const depotTotal = addQty(...depotRows.filter((r) => r.productId === p.id).map((r) => r.quantity));
    const issues: string[] = [];
    if (Math.abs(subQty(qtyNum(p.totalStock), depotTotal)) > 0.0005) issues.push('TOTAL_STALE');
    if (depotTotal > 0 && !(p.purchasePrice > 0)) issues.push('NO_COST');
    if (depotTotal > 0 && !(p.wholesalePrice > 0)) issues.push('NO_WHOLESALE_PRICE');
    return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, storedTotal: qtyNum(p.totalStock), depotTotal, purchasePrice: p.purchasePrice, wholesalePrice: p.wholesalePrice, costValue: Math.round(depotTotal * (p.purchasePrice || 0) * 100) / 100, issues };
  });

  return { baseCurrency: base, since: opts.invoiceIds?.length ? null : since.toISOString(), invoices: out, products: productsOut, summary: { invoices: out.length, withIssues: out.filter((i) => i.issues.length).length, missingLines: out.reduce((n, i) => n + i.lines.filter((l) => l.status === 'MISSING').length, 0), staleTotals: productsOut.filter((p) => p.issues.includes('TOTAL_STALE')).length } };
}

/**
 * Repairs what is safe to repair, and only after re-checking it inside one transaction:
 *  - a posted line whose stock movement is MISSING gets its STOCK_IN movement, the depot quantity and the product's
 *    moving-average cost (same rule as posting), marked "Reconciliation repair";
 *  - a product total that disagrees with its depot rows is re-derived from them.
 * Never touches the invoice, its amounts or its journal; never removes stock; a second run finds nothing to do.
 */
export async function repairPurchase(invoiceId: string, actor: Actor) {
  const base = await companyCurrency();
  const done = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "PurchaseInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    if (!locked.length) throw new PurchasingError(404, 'Purchase invoice not found.');
    if (locked[0].status !== 'POSTED') throw new PurchasingError(409, 'Only posted purchase invoices are reconciled. A draft has not moved any stock yet.');
    const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } });
    const rate = inv.currency === base ? 1 : Number(inv.exchangeRate);
    const repaired: { sku: string; qty: number; unitCost: number }[] = [];
    const productIds = Array.from(new Set(inv.items.map((i) => i.productId)));
    for (const productId of productIds) {
      const existing = await tx.stockTransaction.count({ where: { type: 'STOCK_IN', referenceNumber: inv.purchaseNumber, productId } });
      if (existing > 0) continue; // already received (or repaired): never a second time
      const lines = inv.items.filter((i) => i.productId === productId);
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) continue; // reported as NO_PRODUCT, not repairable here
      const qty = addQty(...lines.map((l) => l.quantity));
      // the line's own net cost (without invoice-level charges, which belong to the original posting's journal)
      const value = lines.reduce((s, l) => s.plus(dec(l.lineTotal).times(rate > 0 ? rate : 1)), dec(0));
      const unitCost = qty > 0 ? round4(value.div(qty)) : 0;
      const onHand = await tx.depotInventory.aggregate({ where: { productId }, _sum: { quantity: true } });
      const before = qtyNum(onHand._sum.quantity), qb = Math.max(0, before);
      const newCost = qb + qty > 0 ? (qb * (product.purchasePrice || 0) + value.toNumber()) / (qb + qty) : product.purchasePrice;
      await tx.depotInventory.upsert({
        where: { productId_depotId: { productId, depotId: inv.depotId } },
        update: { quantity: { increment: qty }, availableQuantity: { increment: qty } },
        create: { productId, depotId: inv.depotId, quantity: qty, availableQuantity: qty },
      });
      await tx.stockTransaction.create({
        data: {
          type: 'STOCK_IN', productId, productSku: product.sku, productName: product.name, targetDepotId: inv.depotId, targetDepotName: inv.depotName,
          quantity: qty, unitCost, referenceNumber: inv.purchaseNumber, createdBy: actor.name,
          notes: `Reconciliation repair: stock of posted purchase ${inv.purchaseNumber} (${inv.supplierName} ${inv.supplierInvoiceNumber}) that was never received`,
        },
      });
      await tx.product.update({ where: { id: productId }, data: { purchasePrice: Math.round(newCost * 10000) / 10000, totalStock: addQty(before, qty) } });
      repaired.push({ sku: product.sku, qty, unitCost });
    }
    // derived totals: re-computed from the depot rows (nothing invented)
    const totals: { sku: string; from: number; to: number }[] = [];
    for (const productId of productIds) {
      const p = await tx.product.findUnique({ where: { id: productId }, select: { sku: true, totalStock: true } });
      if (!p) continue;
      const sum = await tx.depotInventory.aggregate({ where: { productId }, _sum: { quantity: true } });
      const real = qtyNum(sum._sum.quantity);
      if (Math.abs(subQty(qtyNum(p.totalStock), real)) > 0.0005) {
        await tx.product.update({ where: { id: productId }, data: { totalStock: real } });
        totals.push({ sku: p.sku, from: qtyNum(p.totalStock), to: real });
      }
    }
    return { purchaseNumber: inv.purchaseNumber, depotName: inv.depotName, repaired, totals };
  });
  if (done.repaired.length || done.totals.length) {
    await writeAudit(actor, {
      action: 'PURCHASE_STOCK_RECONCILED', entityType: 'PURCHASE_INVOICE', entityId: invoiceId, entityLabel: done.purchaseNumber,
      description: `Reconciliation of ${done.purchaseNumber}: ${done.repaired.length} missing stock movement(s) created${done.totals.length ? `, ${done.totals.length} product total(s) re-derived` : ''}`,
      newValue: done,
    });
  }
  return done;
}
