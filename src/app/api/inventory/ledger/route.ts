import { NextRequest, NextResponse } from 'next/server';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { ledger, ledgerCheck } from '@/lib/inventory/ledger';

export const dynamic = 'force-dynamic';

/** Stock ledger. ?productId=&depotId=&type=&from=YYYY-MM-DD&to=&q=&page=&limit= ; ?check=1 compares ledger vs balances. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.read');
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const scoped = depotIdFilter(auth.user);
  try {
    if (sp.get('check') === '1') {
      const r = await ledgerCheck();
      return NextResponse.json(scoped ? { ...r, differences: r.differences.filter((d) => d.depotId === scoped) } : r, { headers: { 'Cache-Control': 'no-store' } });
    }
    const day = (v: string | null, end = false) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) : undefined);
    const limit = Math.min(500, Number(sp.get('limit')) || 100), page = Math.max(1, Number(sp.get('page')) || 1);
    const TYPES = ['STOCK_IN', 'STOCK_TRANSFER', 'STOCK_ADJUSTMENT', 'SALE_DISPATCH', 'RETURN'];
    const type = TYPES.includes(String(sp.get('type'))) ? String(sp.get('type')) : undefined;
    const r = await ledger({ productId: sp.get('productId') || undefined, depotId: scoped || sp.get('depotId') || null, type, from: day(sp.get('from')), to: day(sp.get('to'), true), q: sp.get('q')?.trim() || undefined, take: limit, skip: (page - 1) * limit });
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[ledger]', e?.message);
    return NextResponse.json({ error: 'The stock ledger could not be loaded.' }, { status: 500 });
  }
}
