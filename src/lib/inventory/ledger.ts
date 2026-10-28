import 'server-only';
import { prisma } from '@/lib/prisma';
import { addQty, qtyNum, subQty } from '@/lib/quantity';

/**
 * The stock ledger (StockTransaction rows) as quantity in / out of each depot, with a running balance.
 * For one product the running balance is anchored on the actual depot balance: movements recorded before the ledger was
 * complete (old opening stock, dispatches before they were logged) appear as one "not in the ledger" opening line, so
 * the last running balance always equals the stock on hand and any gap is visible instead of hidden.
 */
export interface LedgerRow {
  id: string; date: string; reference: string; type: string; productId: string; sku: string; name: string;
  fromDepot: string | null; toDepot: string | null; qtyIn: number; qtyOut: number; balance: number | null;
  unitCost: number; valueImpact: number; user: string; notes: string;
}

/** Signed effect of one movement on a depot (null = all depots together). */
export function effectOn(m: { type: string; quantity: unknown; sourceDepotId: string | null; targetDepotId: string | null }, depotId: string | null): number {
  const q = qtyNum(m.quantity);
  switch (m.type) {
    case 'STOCK_IN': return !depotId || m.targetDepotId === depotId ? q : 0;
    case 'RETURN': return !depotId || (m.targetDepotId ?? m.sourceDepotId) === depotId ? q : 0;
    case 'SALE_DISPATCH': return !depotId || m.sourceDepotId === depotId ? -q : 0;
    case 'STOCK_TRANSFER': return !depotId ? 0 : (m.targetDepotId === depotId ? q : 0) - (m.sourceDepotId === depotId ? q : 0);
    case 'STOCK_ADJUSTMENT': return m.targetDepotId && (!depotId || m.targetDepotId === depotId) ? q : m.sourceDepotId && (!depotId || m.sourceDepotId === depotId) ? -q : 0;
    default: return 0;
  }
}

export async function ledger(opts: { productId?: string; depotId?: string | null; type?: string; from?: Date; to?: Date; q?: string; take?: number; skip?: number }) {
  const depotId = opts.depotId || null;
  const where: any = {};
  if (opts.productId) where.productId = opts.productId;
  if (opts.type) where.type = opts.type;
  if (depotId) where.OR = [{ sourceDepotId: depotId }, { targetDepotId: depotId }];
  if (opts.q) where.AND = [{ OR: [{ productSku: { contains: opts.q, mode: 'insensitive' } }, { productName: { contains: opts.q, mode: 'insensitive' } }, { referenceNumber: { contains: opts.q, mode: 'insensitive' } }] }];
  const dated = { ...where, ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}) };
  const take = Math.min(500, Math.max(1, opts.take ?? 100)), skip = Math.max(0, opts.skip ?? 0);
  const [rows, total] = await Promise.all([
    prisma.stockTransaction.findMany({ where: dated, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, skip }),
    prisma.stockTransaction.count({ where: dated }),
  ]);

  // running balance: only meaningful for one product (in one depot, or all depots together)
  let balanceOf: Map<string, number> | null = null;
  let opening: { unrecorded: number; currentBalance: number; ledgerTotal: number } | null = null;
  if (opts.productId && !opts.type) {
    const all = await prisma.stockTransaction.findMany({ where: { productId: opts.productId, ...(depotId ? { OR: [{ sourceDepotId: depotId }, { targetDepotId: depotId }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, type: true, quantity: true, sourceDepotId: true, targetDepotId: true } });
    const inv = await prisma.depotInventory.findMany({ where: { productId: opts.productId, ...(depotId ? { depotId } : {}) }, select: { quantity: true } });
    const currentBalance = addQty(...inv.map((i) => i.quantity));
    const ledgerTotal = addQty(...all.map((m) => effectOn(m, depotId)));
    const unrecorded = subQty(currentBalance, ledgerTotal);
    opening = { unrecorded, currentBalance, ledgerTotal };
    balanceOf = new Map();
    let bal = unrecorded;
    for (const m of all) { bal = addQty(bal, effectOn(m, depotId)); balanceOf.set(m.id, bal); }
  }

  const out: LedgerRow[] = rows.map((m) => {
    const e = effectOn(m, depotId);
    // a transfer seen across all depots: show both sides
    const isTransferAll = m.type === 'STOCK_TRANSFER' && !depotId;
    const qtyIn = isTransferAll ? qtyNum(m.quantity) : e > 0 ? e : 0;
    const qtyOut = isTransferAll ? qtyNum(m.quantity) : e < 0 ? -e : 0;
    return {
      id: m.id, date: m.createdAt.toISOString(), reference: m.referenceNumber, type: m.type, productId: m.productId, sku: m.productSku, name: m.productName,
      fromDepot: m.sourceDepotName, toDepot: m.type === 'RETURN' && !m.targetDepotName ? m.sourceDepotName : m.targetDepotName,
      qtyIn, qtyOut, balance: balanceOf?.get(m.id) ?? null, unitCost: m.unitCost, valueImpact: Math.round(e * (m.unitCost || 0) * 100) / 100,
      user: m.createdBy, notes: m.notes || '',
    };
  });
  return { rows: out, total, opening };
}

/** Ledger vs balances for every product/depot: where the stock on hand is not explained by recorded movements. */
export async function ledgerCheck() {
  const [inv, moves] = await Promise.all([
    prisma.depotInventory.findMany({ select: { productId: true, depotId: true, quantity: true, product: { select: { sku: true, name: true, purchasePrice: true } }, depot: { select: { name: true } } } }),
    prisma.stockTransaction.findMany({ select: { productId: true, type: true, quantity: true, sourceDepotId: true, targetDepotId: true } }),
  ]);
  const key = (p: string, d: string) => `${p}|${d}`;
  const sums = new Map<string, number>();
  for (const m of moves) for (const d of Array.from(new Set([m.sourceDepotId, m.targetDepotId].filter(Boolean) as string[]))) {
    const k = key(m.productId, d);
    sums.set(k, addQty(sums.get(k) ?? 0, effectOn(m, d)));
  }
  const rows = inv.map((i) => {
    const ledgerQty = sums.get(key(i.productId, i.depotId)) ?? 0;
    const diff = subQty(i.quantity, ledgerQty);
    return { productId: i.productId, sku: i.product.sku, name: i.product.name, depotId: i.depotId, depotName: i.depot.name, balance: qtyNum(i.quantity), ledger: ledgerQty, unrecorded: diff };
  }).filter((r) => r.unrecorded !== 0);
  return { differences: rows, checked: inv.length };
}
