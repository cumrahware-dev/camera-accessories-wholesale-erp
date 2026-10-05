import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { parseTaxInput, pickDefault, syncCatalogueTax } from '@/lib/tax';

export const dynamic = 'force-dynamic';

const NEEDS_DEFAULT = 'There must always be an active default tax in force. Make another tax the default first.';

/** Edit a tax rate. Changing the default re-aligns the products that follow it; documents already created are never touched. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { error, data } = parseTaxInput(body, false);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  try {
    const before = await prisma.taxRate.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'Tax rate not found.' }, { status: 404 });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.taxRate.update({ where: { id }, data: data as any });
      if (row.isDefault && row.isActive && row.effectiveFrom.getTime() <= Date.now()) {
        await tx.taxRate.updateMany({ where: { id: { not: row.id }, isDefault: true }, data: { isDefault: false } });
      }
      if (!pickDefault(await tx.taxRate.findMany()).id) throw new Error('NO_DEFAULT');
      await syncCatalogueTax(tx);
      return row;
    });
    await writeAudit(actor, { action: 'TAX_RATE_UPDATED', entityType: 'TaxRate', entityId: id, entityLabel: `${updated.name} ${updated.rate}%`, description: `Tax rate ${updated.name} changed from ${before.rate}% to ${updated.rate}%`, previousValue: { rate: before.rate, isDefault: before.isDefault, isActive: before.isActive }, newValue: { rate: updated.rate, isDefault: updated.isDefault, isActive: updated.isActive } });
    return NextResponse.json(updated);
  } catch (e: any) {
    if (e?.message === 'NO_DEFAULT') return NextResponse.json({ error: NEEDS_DEFAULT }, { status: 400 });
    console.error('[tax-rates] update failed:', e?.message);
    return NextResponse.json({ error: 'Could not save the tax rate.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  try {
    const row = await prisma.taxRate.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Tax rate not found.' }, { status: 404 });
    const rest = (await prisma.taxRate.findMany()).filter((r) => r.id !== id);
    if (!pickDefault(rest).id) return NextResponse.json({ error: NEEDS_DEFAULT }, { status: 400 });
    // Documents keep the rate stored on each line, so nothing historical depends on this row.
    await prisma.taxRate.delete({ where: { id } });
    await writeAudit(actor, { action: 'TAX_RATE_DELETED', entityType: 'TaxRate', entityId: id, entityLabel: `${row.name} ${row.rate}%`, description: `Tax rate ${row.name} ${row.rate}% deleted` });
    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    console.error('[tax-rates] delete failed:', e?.message);
    return NextResponse.json({ error: 'Could not delete the tax rate.' }, { status: 500 });
  }
}
