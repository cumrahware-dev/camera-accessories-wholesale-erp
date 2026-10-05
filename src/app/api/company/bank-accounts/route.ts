import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { validateBank } from '@/lib/company-input';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const { errors, data } = validateBank(body, true);
  if (Object.keys(errors).length) return NextResponse.json({ error: 'Please correct the highlighted fields.', fields: errors }, { status: 400 });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.bankAccount.count();
      // the first account is always the default; a later one only if asked
      const makeDefault = count === 0 || data.isDefault === true;
      const isActive = count === 0 ? true : data.isActive !== false;
      if (makeDefault) await tx.bankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.bankAccount.create({ data: { ...(data as any), isDefault: makeDefault && isActive, isActive, sortOrder: count } });
    });
    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, { action: 'BANK_ACCOUNT_CREATED', entityType: 'BankAccount', entityId: created.id, entityLabel: `${created.bankName} ${created.currency}`.trim(), description: `Bank account ${created.bankName} ${created.currency} added` });
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    console.error('[bank] create failed:', e?.message);
    return NextResponse.json({ error: 'Could not save the bank account.' }, { status: 500 });
  }
}
