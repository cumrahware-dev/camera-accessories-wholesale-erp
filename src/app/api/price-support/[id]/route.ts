import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { getSupport, updateSupport } from '@/lib/purchasing/price-support';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'price_support.read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await getSupport((await params).id));
  } catch (e) {
    return purchasingError(e);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'price_support.write');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await updateSupport((await params).id, await req.json().catch(() => ({})), actorOf(auth.user)));
  } catch (e) {
    return purchasingError(e);
  }
}
