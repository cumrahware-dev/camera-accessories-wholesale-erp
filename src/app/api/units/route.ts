import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { clearUnitCache, listUnits } from '@/lib/units';
import { writeAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Units of measure for product forms and document lines. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listUnits(true), { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Add a unit (Super Admin / settings.write): { code, name, decimals 0..3 }. */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => ({}));
  const code = String(b?.code ?? '').trim().slice(0, 12);
  const name = String(b?.name ?? '').trim().slice(0, 60);
  const decimals = Number(b?.decimals);
  if (!code || !/^[A-Za-z][A-Za-z0-9.\- ]*$/.test(code)) return NextResponse.json({ error: 'Enter a short unit code, e.g. Mt, Kg, Sq.m.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Enter the unit name.' }, { status: 400 });
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) return NextResponse.json({ error: 'Decimal places must be 0, 1, 2 or 3.' }, { status: 400 });
  if (await prisma.unitOfMeasure.findFirst({ where: { code: { equals: code, mode: 'insensitive' } } })) return NextResponse.json({ error: `Unit ${code} already exists.` }, { status: 409 });
  const unit = await prisma.unitOfMeasure.create({ data: { code, name, decimals, sortOrder: 100 } });
  clearUnitCache();
  await writeAudit(auth.user, { action: 'UNIT_CREATED', entityType: 'UNIT', entityId: unit.id, entityLabel: unit.code, description: `Unit of measure ${code} (${decimals} decimals) added` });
  return NextResponse.json(unit, { status: 201 });
}
