import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { reconcilePurchases } from '@/lib/purchasing/reconciliation';
import { purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/** Read-only reconciliation of posted purchase invoices against stock movements and balances. ?days=30 or ?ids=a,b */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.post');
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const ids = (sp.get('ids') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200);
    return NextResponse.json(await reconcilePurchases({ days: Number(sp.get('days')) || 30, invoiceIds: ids }));
  } catch (e) {
    return purchasingError(e);
  }
}
