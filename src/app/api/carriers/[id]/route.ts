import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { parseCarrierInput } from '@/lib/carriers';

export const dynamic = 'force-dynamic';

/** Carriers are master data referenced by shipments: edit and activate/deactivate, never delete (see schema
 * note on Shipment.carrier — onDelete: Restrict backs this up at the database level too). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const { error, data } = parseCarrierInput(body, false);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!Object.keys(data || {}).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  try {
    const existing = await prisma.carrier.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'Carrier not found.' }, { status: 404 });
    const updated = await prisma.carrier.update({
      where: { id },
      data: { ...(data as any), updatedById: actor.id, updatedByName: actor.name },
    });
    const statusChanged = typeof (data as any).isActive === 'boolean' && (data as any).isActive !== existing.isActive;
    await writeAudit(actor, {
      action: statusChanged ? (updated.isActive ? 'CARRIER_ACTIVATED' : 'CARRIER_DEACTIVATED') : 'CARRIER_UPDATED',
      entityType: 'Carrier', entityId: updated.id, entityLabel: updated.name,
      description: statusChanged ? `Carrier ${updated.name} ${updated.isActive ? 'activated' : 'deactivated'}` : `Carrier ${updated.name} updated`,
      previousValue: existing, newValue: updated,
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.code === 'P2002') return NextResponse.json({ error: `A carrier named "${(data as any).name}" already exists.` }, { status: 409 });
    console.error('[carriers] update failed:', e?.message);
    return NextResponse.json({ error: 'Could not update the carrier.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  const carrier = await prisma.carrier.findUnique({ where: { id } });
  if (!carrier) return NextResponse.json({ error: 'Carrier not found.' }, { status: 404 });
  return NextResponse.json(carrier);
}
