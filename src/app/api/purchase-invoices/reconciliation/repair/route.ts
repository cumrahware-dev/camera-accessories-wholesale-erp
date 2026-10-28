import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { repairPurchase } from '@/lib/purchasing/reconciliation';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/** Creates ONLY missing stock movements of a posted purchase (and re-derives stale product totals). Requires confirm: true. */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.post');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  if (!body?.invoiceId || body.confirm !== true) return NextResponse.json({ error: 'Send { invoiceId, confirm: true } after reviewing the reconciliation report.' }, { status: 400 });
  try {
    return NextResponse.json(await repairPurchase(String(body.invoiceId), actorOf(auth.user)));
  } catch (e) {
    return purchasingError(e);
  }
}
