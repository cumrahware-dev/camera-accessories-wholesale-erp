import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/** Receiving depots for the purchase-invoice form: active depots only, no stock statistics (so the form does not depend on the depot report queries). */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.read');
  if (!auth.ok) return auth.response;
  try {
    const depots = await prisma.depot.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ isCentralHub: 'desc' }, { name: 'asc' }], select: { id: true, name: true, code: true, city: true } });
    return NextResponse.json(depots);
  } catch (e) {
    return purchasingError(e);
  }
}
