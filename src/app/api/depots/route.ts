import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { clientIp } from '@/lib/auth-rate-limit';
import { createDepot, depotStats, depotView } from '@/lib/services/depot-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

/**
 * Depots the caller may see. A depot-bound user gets exactly their own depot; everyone else gets the list.
 * ?status=ACTIVE limits it to depots that can currently be used (pickers).
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'depots.read');
  if (!auth.ok) return auth.response;

  try {
    const scoped = depotIdFilter(auth.user);
    const status = req.nextUrl.searchParams.get('status');
    const where: any = {};
    if (scoped) where.id = scoped;
    if (status === 'ACTIVE' || status === 'INACTIVE') where.status = status;

    const depots = await prisma.depot.findMany({ where, orderBy: { createdAt: 'asc' } });
    const ids = depots.map((d) => d.id);
    const stats = ids.length ? await depotStats(ids) : {};
    const stock = ids.length
      ? await prisma.depotInventory.findMany({
          where: { depotId: { in: ids } },
          select: { depotId: true, quantity: true, product: { select: { wholesalePrice: true, sellingPrice: true, purchasePrice: true } } },
        })
      : [];
    const value: Record<string, number> = {};
    for (const r of stock) {
      const price = r.product?.wholesalePrice || r.product?.sellingPrice || r.product?.purchasePrice || 0;
      value[r.depotId] = (value[r.depotId] || 0) + (r.quantity || 0) * price;
    }

    const canManage = hasPermission(auth.user.role, 'depots.write', auth.user.permissionRevokes);
    return NextResponse.json(
      depots.map((d) => {
        const s = stats[d.id];
        const base = {
          id: d.id, code: d.code, name: d.name, city: d.city, country: d.country, address: d.address,
          contactPerson: d.contactPerson, email: d.email, phone: d.phone, isCentralHub: d.isCentralHub, status: d.status,
          totalStockUnits: s?.stockUnits || 0, totalStockValue: value[d.id] || 0, activeOrdersCount: s?.activeOrders || 0,
          createdAt: d.createdAt, updatedAt: d.updatedAt,
        };
        return canManage ? { ...base, ...depotView(d), userCount: s?.users || 0, shippedCount: s?.shipped || 0 } : base;
      })
    );
  } catch (e) {
    return serviceError(e, 'depots GET');
  }
}

/** Creates a depot and generates its access code. The code is in THIS response only. */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'depots.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    const { depot, accessCode } = await createDepot(body, auth.user, clientIp(req));
    return NextResponse.json({ ...depot, totalStockUnits: 0, totalStockValue: 0, activeOrdersCount: 0, accessCode }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return serviceError(e, 'depots POST');
  }
}
