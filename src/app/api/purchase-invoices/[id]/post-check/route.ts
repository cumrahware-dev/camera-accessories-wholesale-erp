import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { postingReadiness } from '@/lib/purchasing/purchase-invoices';
import { purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/** Read-only: can this draft be posted, and if not, exactly why. Changes nothing. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'purchases.read');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json(await postingReadiness(id));
  } catch (e) {
    return purchasingError(e);
  }
}
