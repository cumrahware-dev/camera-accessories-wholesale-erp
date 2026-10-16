import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.read');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { productId, depotId, quantity } = body;

    if (!productId || !depotId || quantity === undefined) {
      return NextResponse.json({ error: 'productId, depotId, and quantity are required' }, { status: 400 });
    }
    const denied = assertDepotAccess(auth.user, depotId);
    if (denied) return denied;

    let available = 0;
    try {
      const inventory = await prisma.depotInventory.findUnique({ where: { productId_depotId: { productId, depotId } } });
      if (inventory) {
        available = inventory.availableQuantity || 0;
      }
    } catch {
      const product = dataStore.getProductById(productId);
      available = product?.depotBreakdown?.[depotId] ?? (product?.totalStock || 0);
    }

    const requested = Number(quantity);
    const check = { available, requested, sufficient: available >= requested, shortage: Math.max(0, requested - available) };
    return NextResponse.json({ success: true, check });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Inventory check failed' }, { status: 500 });
  }
}
