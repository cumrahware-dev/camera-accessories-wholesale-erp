import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { productId, depotId, deltaQty, reason, notes } = body;

    if (!productId || !depotId || deltaQty === undefined || !reason) {
      return NextResponse.json({ error: 'productId, depotId, deltaQty, and reason are required' }, { status: 400 });
    }
    const denied = assertDepotAccess(auth.user, depotId);
    if (denied) return denied;

    const REASONS = ['DAMAGED', 'CYCLE_COUNT', 'FOUND', 'DEFECTIVE', 'OTHER'];
    if (!REASONS.includes(String(reason))) {
      return NextResponse.json({ error: `reason must be one of ${REASONS.join(', ')}` }, { status: 400 });
    }

    const delta = Number(deltaQty);
    if (!Number.isInteger(delta) || delta === 0) {
      return NextResponse.json({ error: 'deltaQty must be a non-zero whole number' }, { status: 400 });
    }

    // Single transaction; the inventory row is created on first adjustment for a product/depot
    // pair, and stock can never go negative (checked atomically in the UPDATE itself).
    try {
      const adjustment = await prisma.$transaction(async (tx) => {
        const [product, depot] = await Promise.all([
          tx.product.findUnique({ where: { id: productId } }),
          tx.depot.findUnique({ where: { id: depotId } }),
        ]);
        if (!product) throw new Error('PRODUCT_NOT_FOUND');
        if (!depot) throw new Error('DEPOT_NOT_FOUND');

        await tx.depotInventory.upsert({
          where: { productId_depotId: { productId, depotId } },
          create: { productId, depotId, quantity: 0, allocatedQuantity: 0, availableQuantity: 0, minStockLevel: product.minStockLevel ?? 5 },
          update: {},
        });
        const before = await tx.depotInventory.findUniqueOrThrow({ where: { productId_depotId: { productId, depotId } } });

        const upd = await tx.depotInventory.updateMany({
          where: {
            productId,
            depotId,
            ...(delta < 0 ? { quantity: { gte: -delta }, availableQuantity: { gte: -delta } } : {}),
          },
          data: { quantity: { increment: delta }, availableQuantity: { increment: delta } },
        });
        if (upd.count !== 1) throw new Error('NEGATIVE_STOCK');

        await tx.product.update({ where: { id: productId }, data: { totalStock: { increment: delta } } });
        return tx.stockAdjustment.create({
          data: {
            productId,
            productSku: product.sku,
            productName: product.name,
            depotId,
            depotName: depot.name,
            deltaQty: delta,
            previousQty: before.quantity,
            newQty: before.quantity + delta,
            reason,
            user: auth.user.name,
            notes,
          },
        });
      });
      return NextResponse.json({ success: true, adjustment });
    } catch (e: any) {
      const m = String(e?.message || '');
      if (m === 'PRODUCT_NOT_FOUND') return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      if (m === 'DEPOT_NOT_FOUND') return NextResponse.json({ error: 'Depot not found' }, { status: 404 });
      if (m === 'NEGATIVE_STOCK') return NextResponse.json({ error: 'Adjustment would make stock negative' }, { status: 400 });
      throw e;
    }
  } catch (error: any) {
    console.error('Stock adjustment error:', error);
    return NextResponse.json({ error: 'Failed to adjust stock' }, { status: 500 });
  }
}
