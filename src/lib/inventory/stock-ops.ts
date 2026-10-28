import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addQty, qtyNum, subQty } from '@/lib/quantity';
import { writeAudit } from '@/lib/audit';

/**
 * Every manual stock change goes through here: one transaction that changes the depot balance (never below zero), keeps
 * the product total in step, writes the business record (StockAdjustment / StockTransfer) AND a row in the stock ledger
 * (StockTransaction), and is audited. No screen may set a balance directly.
 *
 * Ledger direction convention (used by the ledger view):
 *   STOCK_IN, RETURN         quantity INTO targetDepotId (RETURN historically into sourceDepotId)
 *   SALE_DISPATCH            quantity OUT OF sourceDepotId
 *   STOCK_TRANSFER           OUT OF sourceDepotId and INTO targetDepotId
 *   STOCK_ADJUSTMENT         INTO targetDepotId when positive, OUT OF sourceDepotId when negative
 */
type Tx = Prisma.TransactionClient;
export interface Actor { id: string; name: string; role: string }
export class StockError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const ADJUSTMENT_REASONS = ['DAMAGED', 'CYCLE_COUNT', 'FOUND', 'DEFECTIVE', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Core of an adjustment, inside an existing transaction. delta != 0. */
async function adjustInTx(tx: Tx, actor: Actor, a: { productId: string; depotId: string; delta: number; reason: AdjustmentReason; notes?: string; reference?: string }) {
  const [product, depot] = await Promise.all([tx.product.findUnique({ where: { id: a.productId } }), tx.depot.findUnique({ where: { id: a.depotId } })]);
  if (!product) throw new StockError(404, 'Product not found.');
  if (!depot) throw new StockError(404, 'Depot not found.');
  await tx.depotInventory.upsert({
    where: { productId_depotId: { productId: a.productId, depotId: a.depotId } },
    create: { productId: a.productId, depotId: a.depotId, quantity: 0, allocatedQuantity: 0, availableQuantity: 0, minStockLevel: product.minStockLevel ?? 5 },
    update: {},
  });
  const before = await tx.depotInventory.findUniqueOrThrow({ where: { productId_depotId: { productId: a.productId, depotId: a.depotId } } });
  // the balance check is part of the UPDATE itself: two users cannot both take the last units
  const upd = await tx.depotInventory.updateMany({
    where: { productId: a.productId, depotId: a.depotId, ...(a.delta < 0 ? { quantity: { gte: -a.delta }, availableQuantity: { gte: -a.delta } } : {}) },
    data: { quantity: { increment: a.delta }, availableQuantity: { increment: a.delta } },
  });
  if (upd.count !== 1) throw new StockError(409, `Not enough stock: ${product.sku} has ${qtyNum(before.availableQuantity)} available in ${depot.name}; the adjustment would make it negative.`);
  await tx.product.update({ where: { id: a.productId }, data: { totalStock: { increment: a.delta } } });
  const newQty = addQty(before.quantity, a.delta);
  const adjustment = await tx.stockAdjustment.create({
    data: { productId: a.productId, productSku: product.sku, productName: product.name, depotId: a.depotId, depotName: depot.name, deltaQty: a.delta, previousQty: before.quantity, newQty, reason: a.reason as any, user: actor.name, notes: a.notes || null },
  });
  await tx.stockTransaction.create({
    data: {
      type: 'STOCK_ADJUSTMENT', productId: a.productId, productSku: product.sku, productName: product.name,
      ...(a.delta > 0 ? { targetDepotId: depot.id, targetDepotName: depot.name } : { sourceDepotId: depot.id, sourceDepotName: depot.name }),
      quantity: Math.abs(a.delta), unitCost: product.purchasePrice || 0, referenceNumber: a.reference || `ADJ-${adjustment.id.slice(-8).toUpperCase()}`,
      notes: `${a.reason}${a.notes ? `: ${a.notes}` : ''} (${qtyNum(before.quantity)} -> ${newQty})`, createdBy: actor.name,
    },
  });
  return { adjustment, product, depot, previousQty: qtyNum(before.quantity), newQty };
}

/** A stock adjustment (+/-) with reason; refused if it would make stock negative. */
export async function adjustStock(actor: Actor, a: { productId: string; depotId: string; delta: number; reason: string; notes?: string }) {
  if (!ADJUSTMENT_REASONS.includes(a.reason as AdjustmentReason)) throw new StockError(400, `Reason must be one of ${ADJUSTMENT_REASONS.join(', ')}.`);
  if (!Number.isFinite(a.delta) || a.delta === 0) throw new StockError(400, 'Enter a non-zero adjustment quantity.');
  const r = await prisma.$transaction((tx) => adjustInTx(tx, actor, { ...a, reason: a.reason as AdjustmentReason }), { maxWait: 10_000, timeout: 30_000 });
  await writeAudit(actor, { action: 'STOCK_ADJUSTED', entityType: 'PRODUCT', entityId: a.productId, entityLabel: r.product.sku, description: `Stock of ${r.product.sku} in ${r.depot.name} adjusted by ${a.delta} (${r.previousQty} -> ${r.newQty}), reason ${a.reason}${a.notes ? `: ${a.notes}` : ''}`, previousValue: { quantity: r.previousQty }, newValue: { quantity: r.newQty }, depotId: r.depot.id, depotName: r.depot.name });
  return r.adjustment;
}

/**
 * Sets a depot balance to a counted value (product edit, bulk import), as a traceable adjustment for the difference.
 * Use inside the caller's transaction. Returns the delta (0 = nothing to do).
 */
export async function setStockLevelInTx(tx: Tx, actor: Actor, s: { productId: string; depotId: string; quantity: number; reason?: AdjustmentReason; notes: string; reference?: string }) {
  if (!Number.isFinite(s.quantity) || s.quantity < 0) throw new StockError(400, 'Stock cannot be negative.');
  const cur = await tx.depotInventory.findUnique({ where: { productId_depotId: { productId: s.productId, depotId: s.depotId } } });
  const delta = subQty(s.quantity, cur ? cur.quantity : 0);
  if (delta === 0) return 0;
  await adjustInTx(tx, actor, { productId: s.productId, depotId: s.depotId, delta, reason: s.reason || 'CYCLE_COUNT', notes: s.notes, reference: s.reference });
  return delta;
}

/** Opening stock of a newly created product: a STOCK_IN ledger row for what was put in each depot. */
export async function recordOpeningStock(productId: string, depotQty: Record<string, number>, actor: Actor) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return;
  const depots = await prisma.depot.findMany({ where: { id: { in: Object.keys(depotQty) } }, select: { id: true, name: true } });
  const rows = depots.filter((d) => qtyNum(depotQty[d.id]) > 0).map((d) => ({
    type: 'STOCK_IN' as const, productId, productSku: product.sku, productName: product.name, targetDepotId: d.id, targetDepotName: d.name,
    quantity: qtyNum(depotQty[d.id]), unitCost: product.purchasePrice || 0, referenceNumber: `OPENING-${product.sku}`, notes: 'Opening stock entered when the product was created', createdBy: actor.name,
  }));
  if (rows.length) await prisma.stockTransaction.createMany({ data: rows });
}

async function nextTransferNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const key = `STOCK_TRANSFER_${year}`;
  const prefix = `TR-${year}-`;
  // first use: continue after the highest number already issued (older code numbered from the last row)
  const exists = await tx.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM "DocumentSequence" WHERE "key" = ${key}`;
  if (!exists[0]?.c) {
    const last = await tx.stockTransfer.findMany({ where: { transferNumber: { startsWith: prefix } }, select: { transferNumber: true } });
    const max = last.reduce((m, t) => Math.max(m, parseInt(t.transferNumber.slice(prefix.length), 10) || 0), 0);
    await tx.$executeRaw`INSERT INTO "DocumentSequence" ("key", "nextValue") VALUES (${key}, ${max + 1}) ON CONFLICT ("key") DO NOTHING`;
  }
  const rows = await tx.$queryRaw<{ nextValue: number }[]>`
    UPDATE "DocumentSequence" SET "nextValue" = "nextValue" + 1 WHERE "key" = ${key} RETURNING "nextValue"`;
  return `${prefix}${String(Number(rows[0].nextValue) - 1).padStart(5, '0')}`;
}

/**
 * Moves stock between depots in one transaction: every line must be available at the source (or nothing moves),
 * serial numbers must be IN_STOCK at the source and belong to the product, and both sides are written to the ledger.
 */
export async function transferStock(actor: Actor, t: { sourceDepotId: string; destinationDepotId: string; items: { productId: string; quantity: number; serialNumbers?: string[] }[]; notes?: string }) {
  if (!t.sourceDepotId || !t.destinationDepotId) throw new StockError(400, 'Choose the source and destination depots.');
  if (t.sourceDepotId === t.destinationDepotId) throw new StockError(400, 'Source and destination depots must be different.');
  if (!t.items.length) throw new StockError(400, 'Add at least one product to transfer.');
  const result = await prisma.$transaction(async (tx) => {
    const [src, dst] = await Promise.all([tx.depot.findUnique({ where: { id: t.sourceDepotId } }), tx.depot.findUnique({ where: { id: t.destinationDepotId } })]);
    if (!src || !dst) throw new StockError(404, 'Depot not found.');
    if (dst.status !== 'ACTIVE') throw new StockError(409, `${dst.name} is not active.`);
    const transferNumber = await nextTransferNumber(tx);
    const transfer = await tx.stockTransfer.create({ data: { transferNumber, sourceDepotId: src.id, sourceDepotName: src.name, destinationDepotId: dst.id, destinationDepotName: dst.name, status: 'PENDING', notes: t.notes || null, createdBy: actor.name } });
    for (const it of t.items) {
      const product = await tx.product.findUnique({ where: { id: it.productId } });
      if (!product) throw new StockError(404, `Product ${it.productId} not found.`);
      const q = it.quantity;
      const upd = await tx.depotInventory.updateMany({
        where: { productId: product.id, depotId: src.id, quantity: { gte: q }, availableQuantity: { gte: q } },
        data: { quantity: { decrement: q }, availableQuantity: { decrement: q } },
      });
      if (upd.count !== 1) {
        const have = await tx.depotInventory.findUnique({ where: { productId_depotId: { productId: product.id, depotId: src.id } } });
        throw new StockError(409, `Not enough ${product.sku} in ${src.name}: ${have ? qtyNum(have.availableQuantity) : 0} available, ${q} requested. Nothing was transferred.`);
      }
      await tx.depotInventory.upsert({
        where: { productId_depotId: { productId: product.id, depotId: dst.id } },
        update: { quantity: { increment: q }, availableQuantity: { increment: q } },
        create: { productId: product.id, depotId: dst.id, quantity: q, allocatedQuantity: 0, availableQuantity: q, minStockLevel: product.minStockLevel ?? 5 },
      });
      const serials = Array.from(new Set((it.serialNumbers || []).map((s) => String(s).trim()).filter(Boolean)));
      if (serials.length) {
        if (serials.length > q) throw new StockError(400, `${product.sku}: more serial numbers (${serials.length}) than units (${q}).`);
        const moved = await tx.serialNumber.updateMany({ where: { productId: product.id, depotId: src.id, status: 'IN_STOCK', serialNumber: { in: serials } }, data: { depotId: dst.id, depotName: dst.name } });
        if (moved.count !== serials.length) throw new StockError(409, `${product.sku}: some serial numbers are not in stock at ${src.name}. Nothing was transferred.`);
      }
      await tx.stockTransferItem.create({ data: { transferId: transfer.id, productId: product.id, productSku: product.sku, productName: product.name, quantity: q, serialNumbers: serials } });
      await tx.stockTransaction.create({
        data: { type: 'STOCK_TRANSFER', productId: product.id, productSku: product.sku, productName: product.name, sourceDepotId: src.id, sourceDepotName: src.name, targetDepotId: dst.id, targetDepotName: dst.name, quantity: q, unitCost: product.purchasePrice || 0, referenceNumber: transferNumber, notes: t.notes || `Transfer ${src.name} -> ${dst.name}`, createdBy: actor.name },
      });
    }
    return tx.stockTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: { items: true } });
  }, { maxWait: 10_000, timeout: 30_000 });
  await writeAudit(actor, { action: 'STOCK_TRANSFERRED', entityType: 'STOCK_TRANSFER', entityId: result.id, entityLabel: result.transferNumber, description: `Transfer ${result.transferNumber}: ${result.items.map((i) => `${qtyNum(i.quantity)} x ${i.productSku}`).join(', ')} from ${result.sourceDepotName} to ${result.destinationDepotName}` });
  return result;
}

/**
 * Status of a transfer. The stock moved when the transfer was created, so the status only tracks the shipment:
 * PENDING -> IN_TRANSIT -> COMPLETED. Cancelling would leave the moved stock in place, so it is refused; a reverse
 * transfer moves it back with its own ledger rows.
 */
const TRANSFER_NEXT: Record<string, string[]> = { PENDING: ['IN_TRANSIT', 'COMPLETED'], IN_TRANSIT: ['COMPLETED'], COMPLETED: [], CANCELLED: [] };
export async function setTransferStatus(actor: Actor, id: string, status: string) {
  if (status === 'CANCELLED') throw new StockError(409, 'The stock of this transfer has already moved. Create a reverse transfer to move it back.');
  const t = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!t) throw new StockError(404, 'Stock transfer not found');
  if (!(TRANSFER_NEXT[t.status] || []).includes(status)) throw new StockError(409, `A ${t.status.toLowerCase().replace('_', ' ')} transfer cannot be set to ${status.toLowerCase().replace('_', ' ')}.`);
  const claim = await prisma.stockTransfer.updateMany({ where: { id, status: t.status }, data: { status: status as any, ...(status === 'COMPLETED' ? { receivedAt: new Date() } : {}) } });
  if (claim.count !== 1) throw new StockError(409, 'The transfer was changed by someone else. Reload and try again.');
  await writeAudit(actor, { action: 'STOCK_TRANSFER_STATUS', entityType: 'STOCK_TRANSFER', entityId: t.id, entityLabel: t.transferNumber, description: `Transfer ${t.transferNumber}: ${t.status} -> ${status}`, previousValue: { status: t.status }, newValue: { status } });
  return prisma.stockTransfer.findUniqueOrThrow({ where: { id }, include: { items: true } });
}
