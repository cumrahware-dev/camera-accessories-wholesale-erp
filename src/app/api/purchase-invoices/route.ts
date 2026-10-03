import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { createPurchaseInvoice } from '@/lib/purchasing/purchase-invoices';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.read');
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const where: any = {};
  if (sp.get('supplierId')) where.supplierId = sp.get('supplierId');
  if (sp.get('status') === 'DRAFT' || sp.get('status') === 'POSTED') where.status = sp.get('status');
  const q = sp.get('q')?.trim();
  if (q) where.OR = [
    { purchaseNumber: { contains: q, mode: 'insensitive' } },
    { supplierInvoiceNumber: { contains: q, mode: 'insensitive' } },
    { supplierName: { contains: q, mode: 'insensitive' } },
  ];
  const invoices = await prisma.purchaseInvoice.findMany({
    where, orderBy: { invoiceDate: 'desc' }, take: Math.min(500, Number(sp.get('take')) || 200),
    include: { _count: { select: { items: true } }, priceSupports: { select: { amount: true, status: true } } },
  });
  return NextResponse.json(invoices.map(({ priceSupports, ...i }) => ({
    ...i,
    supportPosted: priceSupports.filter((s) => s.status === 'POSTED').reduce((t, s) => t + s.amount, 0),
    supportCount: priceSupports.length,
  })));
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'purchases.write');
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await createPurchaseInvoice(body, actorOf(auth.user)), { status: 201 });
  } catch (e) {
    return purchasingError(e);
  }
}
