import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * A document line carries the SKU copied from the product master when it was created. For a line where that copy is empty
 * (an import, an old record) the code is read from the product master by the line's productId. Nothing is invented:
 * a line whose product has no SKU stays without one. The stored invoice is not modified.
 */
/** Placeholder values some old records were saved with. */
const isMissing = (v: unknown) => { const t = String(v || '').trim(); return !t || t === 'SKU'; };

export async function withProductSkus<T extends { productId?: string | null; productSku?: string | null }>(items: T[] | undefined | null): Promise<T[]> {
  const list = items || [];
  const need = Array.from(new Set(list.filter((i) => isMissing(i.productSku) && i.productId).map((i) => String(i.productId))));
  if (!need.length) return list;
  const rows = await prisma.product.findMany({ where: { id: { in: need } }, select: { id: true, sku: true } }).catch(() => []);
  const m = new Map(rows.map((r) => [r.id, r.sku]));
  return list.map((i) => (!isMissing(i.productSku) ? i : { ...i, productSku: m.get(String(i.productId)) || '' }));
}
