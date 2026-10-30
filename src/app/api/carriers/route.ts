import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { parseCarrierInput } from '@/lib/carriers';

export const dynamic = 'force-dynamic';

/** Active + inactive carriers (Settings -> Master Data -> Carrier Management). Any signed-in user may read this
 * list: depot staff need it to pick a carrier while shipping, not just Settings admins. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  try {
    const activeOnly = req.nextUrl.searchParams.get('active') === '1';
    const q = req.nextUrl.searchParams.get('q')?.trim();
    const where: any = {};
    if (activeOnly) where.isActive = true;
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }];
    const carriers = await prisma.carrier.findMany({ where, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return NextResponse.json(carriers, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[carriers] list failed:', e?.message);
    return NextResponse.json({ error: 'Could not load carriers.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const { error, data } = parseCarrierInput(body, true);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  try {
    const existing = await prisma.carrier.findUnique({ where: { name: data!.name! } });
    if (existing) return NextResponse.json({ error: `A carrier named "${data!.name}" already exists.` }, { status: 409 });
    const created = await prisma.carrier.create({ data: { ...(data as any), createdById: actor.id, createdByName: actor.name } });
    await writeAudit(actor, { action: 'CARRIER_CREATED', entityType: 'Carrier', entityId: created.id, entityLabel: created.name, description: `Carrier ${created.name} created`, newValue: { type: created.type, isActive: created.isActive } });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.code === 'P2002') return NextResponse.json({ error: `A carrier named "${data!.name}" already exists.` }, { status: 409 });
    console.error('[carriers] create failed:', e?.message);
    return NextResponse.json({ error: 'Could not save the carrier.' }, { status: 500 });
  }
}
