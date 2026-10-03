import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { transitionSupport } from '@/lib/purchasing/price-support';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/** POST { action: 'submit' | 'approve' | 'reject' | 'post', note?: string } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'price_support.write');
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!['submit', 'approve', 'reject', 'post'].includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json(await transitionSupport((await params).id, action as any, actorOf(auth.user), String(body.note || '')));
  } catch (e) {
    return purchasingError(e);
  }
}
