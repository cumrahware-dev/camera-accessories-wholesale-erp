import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Depot dashboard numbers. Every query is filtered by ONE depot id: a depot-bound user's own depot (from the
 * session, any ?depotId= is ignored), or, for company-wide users, the depot they explicitly ask for.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'depot_mobile.view');
  if (!auth.ok) return auth.response;

  const scoped = depotIdFilter(auth.user);
  const depotId = scoped || req.nextUrl.searchParams.get('depotId') || '';
  if (!depotId) return NextResponse.json({ error: 'Choose a depot.' }, { status: 400 });
  const denied = assertDepotAccess(auth.user, depotId);
  if (denied) return denied;

  try {
    const depot = await prisma.depot.findUnique({ where: { id: depotId }, select: { id: true, name: true, code: true, status: true } });
    if (!depot) return NextResponse.json({ error: 'Depot not found.' }, { status: 404 });

    const live = { depotId, documentStatus: { not: 'DRAFT' as const } };
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [incoming, pendingPicking, pendingPacking, readyToShip, shipped, stock, recent] = await Promise.all([
      prisma.taxInvoice.count({ where: { ...live, fulfilmentStatus: 'READY_FOR_PACKING', createdAt: { gte: dayAgo } } }),
      prisma.taxInvoice.count({ where: { ...live, fulfilmentStatus: 'READY_FOR_PACKING' } }),
      prisma.taxInvoice.count({ where: { ...live, fulfilmentStatus: 'PROCESSING' } }),
      prisma.taxInvoice.count({ where: { ...live, fulfilmentStatus: 'PACKED' } }),
      prisma.taxInvoice.count({ where: { ...live, fulfilmentStatus: 'SHIPPED' } }),
      prisma.depotInventory.findMany({ where: { depotId }, select: { quantity: true, allocatedQuantity: true, availableQuantity: true, minStockLevel: true } }),
      prisma.auditLog.findMany({
        where: { depotId },
        select: { id: true, timestamp: true, action: true, userName: true, description: true },
        orderBy: { timestamp: 'desc' },
        take: 8,
      }),
    ]);

    return NextResponse.json({
      depot,
      orders: { incoming, pendingPicking, pendingPacking, readyToShip, shipped },
      inventory: {
        skus: stock.length,
        units: stock.reduce((s, r) => s + r.quantity, 0),
        allocated: stock.reduce((s, r) => s + r.allocatedQuantity, 0),
        available: stock.reduce((s, r) => s + r.availableQuantity, 0),
        lowStock: stock.filter((r) => r.availableQuantity <= r.minStockLevel).length,
      },
      recentActivity: recent,
    });
  } catch (e: any) {
    console.error('[depot overview]', e?.message);
    return NextResponse.json({ error: 'Could not load the depot overview.' }, { status: 500 });
  }
}
