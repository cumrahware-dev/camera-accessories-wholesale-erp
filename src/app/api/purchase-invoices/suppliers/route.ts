import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

/**
 * Suppliers for the purchase-invoice picker. Gated by the purchasing permission (people who may record purchases must be
 * able to choose a supplier) and strict: a database problem is reported as an error, never as an empty list, and no
 * demo data is substituted. Read-only, id + name + currency fields only.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.read');
  if (!auth.ok) return auth.response;
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      take: 2000,
      select: { id: true, name: true, country: true, taxId: true, paymentTerms: true },
    });
    return NextResponse.json(suppliers);
  } catch (e) {
    return purchasingError(e);
  }
}
