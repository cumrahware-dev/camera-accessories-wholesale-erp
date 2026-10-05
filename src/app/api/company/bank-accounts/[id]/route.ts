import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { bankAccountUsage } from '@/lib/company';
import { validateBank } from '@/lib/company-input';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { errors, data } = validateBank(body, false);
  if (Object.keys(errors).length) return NextResponse.json({ error: 'Please correct the highlighted fields.', fields: errors }, { status: 400 });
  try {
    const before = await prisma.bankAccount.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: 'Bank account not found.' }, { status: 404 });
    const willBeActive = data.isActive ?? before.isActive;
    const willBeDefault = data.isDefault ?? before.isDefault;
    if (willBeDefault && !willBeActive) return NextResponse.json({ error: 'The default bank account must be active. Make another account the default first, then deactivate this one.' }, { status: 400 });
    if (before.isDefault && data.isDefault === false) return NextResponse.json({ error: 'Choose another account as the default instead; there must always be one default.' }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isDefault === true) await tx.bankAccount.updateMany({ where: { id: { not: id }, isDefault: true }, data: { isDefault: false } });
      return tx.bankAccount.update({ where: { id }, data: data as any });
    });
    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { action: 'BANK_ACCOUNT_UPDATED', entityType: 'BankAccount', entityId: id, entityLabel: `${updated.bankName} ${updated.currency}`.trim(), description: `Bank account ${updated.bankName} ${updated.currency} updated${data.isActive !== undefined && data.isActive !== before.isActive ? (updated.isActive ? ' (activated)' : ' (deactivated)') : ''}` });
    return NextResponse.json(updated);
  } catch (e: any) {
    console.error('[bank] update failed:', e?.message);
    return NextResponse.json({ error: 'Could not save the bank account.' }, { status: 500 });
  }
}

/** Deleting is only allowed while no issued document carries this account in its frozen details; otherwise deactivate it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const row = await prisma.bankAccount.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: 'Bank account not found.' }, { status: 404 });
    const used = await bankAccountUsage(id);
    if (used > 0) return NextResponse.json({ error: `This account appears on ${used} issued document${used === 1 ? '' : 's'}, so it cannot be deleted. Deactivate it instead: it will no longer appear on new documents.` }, { status: 409 });
    if (row.isDefault && (await prisma.bankAccount.count()) > 1) return NextResponse.json({ error: 'This is the default account. Make another account the default first.' }, { status: 400 });
    await prisma.bankAccount.delete({ where: { id } });
    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { action: 'BANK_ACCOUNT_DELETED', entityType: 'BankAccount', entityId: id, entityLabel: `${row.bankName} ${row.currency}`.trim(), description: `Bank account ${row.bankName} ${row.currency} deleted` });
    return NextResponse.json({ deleted: true });
  } catch (e: any) {
    console.error('[bank] delete failed:', e?.message);
    return NextResponse.json({ error: 'Could not delete the bank account.' }, { status: 500 });
  }
}
