import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'accounting.read');
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const where: any = {};
  if (sp.get('sourceType')) where.sourceType = sp.get('sourceType');
  if (sp.get('sourceId')) where.sourceId = sp.get('sourceId');
  const entries = await prisma.journalEntry.findMany({ where, include: { lines: true }, orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
  // per-account balances across everything returned
  const balances = new Map<string, { code: string; name: string; debit: number; credit: number }>();
  for (const e of entries) for (const l of e.lines) {
    const b = balances.get(l.accountCode) || { code: l.accountCode, name: l.accountName, debit: 0, credit: 0 };
    b.debit += l.debit;
    b.credit += l.credit;
    balances.set(l.accountCode, b);
  }
  return NextResponse.json({ entries, balances: Array.from(balances.values()).sort((a, b) => a.code.localeCompare(b.code)) });
}
