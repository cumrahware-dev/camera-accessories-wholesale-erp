import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { canViewCosts, hasPermission, isDepotRole } from '@/lib/rbac';
import { userView } from '@/lib/services/user-service';
import { serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

/**
 * Depot detail tabs: users | inventory | orders | shipments | activity.
 * Every query is filtered by the depot id in the URL, and the caller must be allowed into that depot
 * (a depot-bound user can only ever open their own).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; section: string }> }) {
  const auth = await guardApi(req, 'depots.read');
  if (!auth.ok) return auth.response;
  const { id, section } = await params;
  const denied = assertDepotAccess(auth.user, id);
  if (denied) return denied;

  try {
    const depot = await prisma.depot.findUnique({ where: { id }, select: { id: true } });
    if (!depot) return NextResponse.json({ error: 'Depot not found.' }, { status: 404 });
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(auth.user.role, p, auth.user.permissionRevokes);

    switch (section) {
      case 'users': {
        if (!can('users.read') && !can('depot_users.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const users = await prisma.user.findMany({
          where: { assignedDepotId: id, isStation: false },
          include: { depot: { select: { id: true, name: true, code: true, status: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(users.map(userView));
      }
      case 'inventory': {
        if (!can('inventory.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await prisma.depotInventory.findMany({
          where: { depotId: id },
          include: { product: { select: { id: true, sku: true, name: true, brand: true, purchasePrice: true, wholesalePrice: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 500,
        });
        const costs = canViewCosts(auth.user.role);
        return NextResponse.json(rows.map((r) => ({
          id: r.id, productId: r.productId, sku: r.product.sku, name: r.product.name, brand: r.product.brand,
          quantity: r.quantity, allocatedQuantity: r.allocatedQuantity, availableQuantity: r.availableQuantity, minStockLevel: r.minStockLevel,
          ...(costs ? { unitCost: r.product.purchasePrice } : {}),
        })));
      }
      case 'orders': {
        if (!can('invoices.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const hideDrafts = !can('invoices.write');
        const orders = await prisma.taxInvoice.findMany({
          where: { depotId: id, ...(hideDrafts ? { documentStatus: { not: 'DRAFT' } } : {}) },
          select: { id: true, invoiceNumber: true, customerCompany: true, fulfilmentStatus: true, paymentStatus: true, documentStatus: true, grandTotal: true, currency: true, issueDate: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        const showMoney = !isDepotRole(auth.user.role); // depot staff fulfil orders; they do not see prices
        return NextResponse.json(orders.map((o) => (showMoney ? o : { ...o, grandTotal: undefined, paymentStatus: undefined })));
      }
      case 'shipments': {
        if (!can('shipments.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await prisma.shipment.findMany({
          where: { depotId: id },
          select: { id: true, shipmentNumber: true, invoiceId: true, courier: true, airwayBillNumber: true, status: true, trackingUrl: true, createdAt: true, invoice: { select: { invoiceNumber: true, customerCompany: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        return NextResponse.json(rows);
      }
      case 'activity': {
        if (!can('audit.read') && !can('depot_users.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await prisma.auditLog.findMany({
          where: { depotId: id },
          select: { id: true, timestamp: true, action: true, userName: true, userRole: true, entityType: true, entityLabel: true, description: true },
          orderBy: { timestamp: 'desc' },
          take: 100,
        });
        return NextResponse.json(rows);
      }
      default:
        return NextResponse.json({ error: 'Unknown section.' }, { status: 404 });
    }
  } catch (e) {
    return serviceError(e, 'depot section');
  }
}
