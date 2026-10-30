import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const maskAccountNumber = (n: string) => {
  const digits = (n || '').replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `•••• ${digits.slice(-4)}`;
};

/**
 * Active bank accounts for a document's "Select Bank Account" picker. Deliberately lighter than GET /api/company
 * (which needs company.read and returns every account, inactive ones included, with raw account numbers): any
 * signed-in user who can create a document needs this list, so the permission here is just "authenticated" —
 * same reasoning as /api/tax-rates and /api/carriers. The account number is masked; full details are only on
 * the Settings -> Company & Business bank management screen.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  try {
    const currency = req.nextUrl.searchParams.get('currency')?.trim().toUpperCase();
    const rows = await prisma.bankAccount.findMany({
      where: { isActive: true, ...(currency ? { currency } : {}) },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        bankName: true,
        branch: true,
        accountName: true,
        accountNumber: true,
        iban: true,
        swiftBic: true,
        bankAddress: true,
        currency: true,
        isDefault: true,
      },
    });
    return NextResponse.json(
      rows.map((r) => ({ ...r, accountNumberMasked: maskAccountNumber(r.accountNumber) })),
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (e: any) {
    console.error('[bank-accounts] list failed:', e?.message);
    return NextResponse.json({ error: 'Could not load bank accounts.' }, { status: 500 });
  }
}
