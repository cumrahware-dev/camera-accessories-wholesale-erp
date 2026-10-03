import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { postPurchaseInvoice } from '@/lib/purchasing/purchase-invoices';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'purchases.post');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json(await postPurchaseInvoice(id, actorOf(auth.user)));
  } catch (e) {
    return purchasingError(e);
  }
}
