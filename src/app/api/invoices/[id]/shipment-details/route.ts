import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { ShipmentDetailsError, getShipmentDetails, saveShipmentDetails } from '@/lib/services/shipment-details';

export const dynamic = 'force-dynamic';

/** A missing table means the shipment-details migration has not been applied: say so instead of a generic failure. */
function dbProblem(e: any) {
  console.error('[shipment-details]', e?.code || '', e?.message);
  if (e?.code === 'P2021' || e?.code === 'P2022' || /does not exist/i.test(e?.message || '')) {
    return NextResponse.json({ error: 'Shipment details are not available yet: the database update for this feature has not been applied. Ask your administrator to run the pending database migrations (prisma migrate deploy).', code: 'MIGRATION_PENDING' }, { status: 503 });
  }
  return NextResponse.json({ error: 'The shipment details could not be saved or loaded. Please try again.' }, { status: 500 });
}

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
  try {
    return NextResponse.json(await getShipmentDetails(id));
  } catch (e: any) {
    return dbProblem(e);
  }
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
    return dbProblem(e);
  }
}
