import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { ShipmentUpdateError, findShipmentByRef, updateShipment } from '@/lib/services/shipment-update';
import { clientIp } from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

async function findShipment(id: string) {
  return prisma.shipment.findFirst({ where: { OR: [{ id }, { shipmentNumber: id }, { invoiceId: id }] }, include: { invoice: true } });
}

/** A shipment belongs to one depot. A depot-bound user asking for another depot's shipment gets 403 whatever id they send. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'shipments.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const shipment = await findShipment(id);
    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, shipment.depotId);
    if (denied) return denied;
    return NextResponse.json(shipment);
  } catch (error) {
    console.error('Error fetching shipment detail:', error);
    return NextResponse.json({ error: 'Failed to fetch shipment' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'shipments.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const existing = await findShipmentByRef(id);
    if (!existing) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, existing.depotId);
    if (denied) return denied;
    // shipment + invoice status change together in one transaction (lib/services/shipment-update)
    const updated = await updateShipment({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, existing, body, clientIp(req));
    return NextResponse.json({ success: true, shipment: updated });
  } catch (error: any) {
    if (error instanceof ShipmentUpdateError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error updating shipment:', error?.message);
    return NextResponse.json({ error: 'Failed to update shipment' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: Ctx) {
  return PATCH(req, context);
}
