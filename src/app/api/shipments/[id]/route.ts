import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ['READY', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const COURIERS = ['DHL_EXPRESS', 'FEDEX_INTERNATIONAL', 'ARAMEX', 'EMIRATES_SKYCARGO', 'UPS', 'OTHER'] as const;

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
  const { status, courier, trackingUrl, airwayBillNumber } = body;

  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Unknown shipment status.' }, { status: 400 });
  }
  if (courier !== undefined && !(COURIERS as readonly string[]).includes(courier)) {
    return NextResponse.json({ error: 'Unknown courier.' }, { status: 400 });
  }

  try {
    const existing = await findShipment(id);
    if (!existing) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, existing.depotId);
    if (denied) return denied;

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.shipment.update({
        where: { id: existing.id },
        data: {
          ...(status && { status }),
          ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
          ...(courier && { courier }),
          ...(typeof trackingUrl === 'string' && trackingUrl && { trackingUrl: trackingUrl.slice(0, 500) }),
          ...(typeof airwayBillNumber === 'string' && airwayBillNumber && { airwayBillNumber: airwayBillNumber.slice(0, 80) }),
        },
      });
      if (status === 'DELIVERED' && existing.invoiceId) {
        await tx.taxInvoice.update({ where: { id: existing.invoiceId }, data: { fulfilmentStatus: 'DELIVERED' } });
      }
      return s;
    });

    await writeAudit(auth.user, {
      action: 'SHIPMENT_UPDATED', entityType: 'Shipment', entityId: existing.id, entityLabel: existing.shipmentNumber,
      description: `Shipment ${existing.shipmentNumber} updated${status ? ` (status → ${status})` : ''}`, ip: clientIp(req),
      depotId: existing.depotId, depotName: existing.depotName, previousValue: existing.status, newValue: status,
    });
    return NextResponse.json({ success: true, shipment: updated });
  } catch (error: any) {
    console.error('Error updating shipment:', error?.message);
    return NextResponse.json({ error: 'Failed to update shipment' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: Ctx) {
  return PATCH(req, context);
}
