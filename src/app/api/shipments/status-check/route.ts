import { NextRequest, NextResponse } from 'next/server';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { shipmentStatusCheck, syncStatusesFromShipments } from '@/lib/services/shipment-status-check';

export const dynamic = 'force-dynamic';

/** Where every live order stands (pending / in transit / status mismatches). Read-only. Depot users see their depot. Optional ?q= and ?numbers=. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'shipments.read');
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    // ?q=Tanweer narrows every list to an invoice number or customer; ?numbers=INV-1,INV-2 classifies those invoices one by one
    const numbers = (sp.get('numbers') || '').split(',').map((x) => x.trim()).filter(Boolean);
    return NextResponse.json(await shipmentStatusCheck(depotIdFilter(auth.user) || undefined, { q: sp.get('q') || undefined, numbers }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[shipment status check]', e?.message);
    return NextResponse.json({ error: 'The shipment status check could not be run.' }, { status: 500 });
  }
}

/**
 * Sets invoices whose shipment record exists but whose status lags behind to SHIPPED (or DELIVERED). Status only:
 * no stock, payment or amount changes. Needs { confirm: true }; every change is audited.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'shipments.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) return NextResponse.json({ error: 'Review GET /api/shipments/status-check first, then send { confirm: true }.' }, { status: 400 });
  try {
    return NextResponse.json(await syncStatusesFromShipments({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, depotIdFilter(auth.user) || undefined));
  } catch (e: any) {
    console.error('[shipment status sync]', e?.message);
    return NextResponse.json({ error: 'The statuses could not be synchronised. Nothing further was changed.' }, { status: 500 });
  }
}
