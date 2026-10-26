import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { ShipmentDetailsError, getShipmentDetails, saveShipmentDetails } from '@/lib/services/shipment-details';

export const dynamic = 'force-dynamic';

async function loadForAccess(id: string, user: any) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id }, select: { id: true, depotId: true, documentStatus: true } });
  if (!inv) return { error: NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }) };
  const denied = assertDepotAccess(user, inv.depotId);
  if (denied) return { error: denied };
  return { inv };
}

/** AWB / packing details recorded after the invoice was issued, with their change history. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const a = await loadForAccess(id, auth.user);
  if (a.error) return a.error;
  return NextResponse.json(await getShipmentDetails(id));
}

/**
 * Adds or updates the supplementary details. Permission 'invoices.shipment_details' only: it does not allow any change to the
 * invoice's lines, VAT, totals, customer or number, and the body is limited to the shipment fields.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'invoices.shipment_details');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const a = await loadForAccess(id, auth.user);
  if (a.error) return a.error;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    return NextResponse.json(await saveShipmentDetails(id, body, { id: auth.user.id, name: auth.user.name, role: auth.user.role }));
  } catch (e: any) {
    if (e instanceof ShipmentDetailsError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[shipment-details]', e?.message);
    return NextResponse.json({ error: 'The shipment details could not be saved. Please try again.' }, { status: 500 });
  }
}
