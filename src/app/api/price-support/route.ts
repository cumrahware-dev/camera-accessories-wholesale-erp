import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { createSupport, listWhere } from '@/lib/purchasing/price-support';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'price_support.read');
  if (!auth.ok) return auth.response;
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams);
    const rows = await prisma.supplierPriceSupport.findMany({ where: listWhere(sp), orderBy: { createdAt: 'desc' }, take: 500 });
    return NextResponse.json(rows);
  } catch (e) {
    return purchasingError(e);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'price_support.write');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await createSupport(await req.json().catch(() => ({})), actorOf(auth.user)), { status: 201 });
  } catch (e) {
    return purchasingError(e);
  }
}
