import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { parseTaxInput, pickDefault, syncCatalogueTax } from '@/lib/tax';

export const dynamic = 'force-dynamic';

/** The configured tax rates and the default in force now. Any signed-in user (documents need the default). */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  try {
    const rows = await prisma.taxRate.findMany({ orderBy: [{ isDefault: 'desc' }, { effectiveFrom: 'desc' }, { name: 'asc' }] });
    const def = pickDefault(rows);
    return NextResponse.json({ default: def, rates: rows.map((r) => ({ ...r, inForce: r.id === def.id })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[tax-rates] list failed:', e?.message);
    return NextResponse.json({ error: 'Could not load tax rates.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const { error, data } = parseTaxInput(body, true);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.taxRate.create({ data: { ...(data as any), createdByName: actor.name } });
      // A new default that is already in force replaces the previous one; a future-dated one is scheduled alongside it.
      if (row.isDefault && row.isActive && row.effectiveFrom.getTime() <= Date.now()) {
        await tx.taxRate.updateMany({ where: { id: { not: row.id }, isDefault: true }, data: { isDefault: false } });
      }
      const all = await tx.taxRate.findMany();
      if (!pickDefault(all).id) throw new Error('NO_DEFAULT');
      await syncCatalogueTax(tx);
      return row;
    });
    await writeAudit(actor, { action: 'TAX_RATE_CREATED', entityType: 'TaxRate', entityId: created.id, entityLabel: `${created.name} ${created.rate}%`, description: `Tax rate ${created.name} ${created.rate}% created${created.isDefault ? ' (default)' : ''}`, newValue: { rate: created.rate, isDefault: created.isDefault } });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e?.message === 'NO_DEFAULT') return NextResponse.json({ error: 'There must always be an active default tax in force. Mark this one as the default, or keep the current default.' }, { status: 400 });
    console.error('[tax-rates] create failed:', e?.message);
    return NextResponse.json({ error: 'Could not save the tax rate.' }, { status: 500 });
  }
}
