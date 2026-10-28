import { parseQty } from '@/lib/quantity';
import { unitDecimals } from '@/lib/units';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { StockError, adjustStock } from '@/lib/inventory/stock-ops';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
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

    // Decimal adjustments (e.g. -0.250 Mt): non-zero, with the decimals the product's unit allows.
    const unitRow = await prisma.product.findUnique({ where: { id: productId }, select: { unit: true } }).catch(() => null);
    const dq = parseQty(String(deltaQty).replace(/^-/, ''), { maxDecimals: (await unitDecimals())(unitRow?.unit) });
    if (dq.error !== undefined) return NextResponse.json({ error: `Adjustment quantity: ${dq.error}` }, { status: 400 });
    const delta: number = String(deltaQty).trim().startsWith('-') || Number(deltaQty) < 0 ? -dq.value : dq.value;

    // One transaction: balance (never negative), product total, StockAdjustment, ledger row; audited (lib/inventory/stock-ops).
    try {
      const adjustment = await adjustStock({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { productId, depotId, delta, reason, notes });
      return NextResponse.json({ success: true, adjustment });
    } catch (e: any) {
      if (e instanceof StockError) return NextResponse.json({ error: e.message }, { status: e.status === 409 ? 400 : e.status });
      throw e;
    }
  } catch (error: any) {
    console.error('Stock adjustment error:', error);
    return NextResponse.json({ error: 'Failed to adjust stock' }, { status: 500 });
  }
}
