import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { deleteDraftPurchaseInvoice, supportSummaryFor, updatePurchaseInvoice } from '@/lib/purchasing/purchase-invoices';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'purchases.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, include: { items: true } });
  if (!inv) return NextResponse.json({ error: 'Purchase invoice not found.' }, { status: 404 });
  const [priceSupport, journal] = await Promise.all([
    supportSummaryFor(id),
    inv.journalEntryId ? prisma.journalEntry.findUnique({ where: { id: inv.journalEntryId }, include: { lines: true } }) : null,
  ]);
  return NextResponse.json({ ...inv, priceSupport, journal });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'purchases.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json(await updatePurchaseInvoice(id, await req.json().catch(() => ({})), actorOf(auth.user)));
  } catch (e) {
    return purchasingError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'purchases.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    await deleteDraftPurchaseInvoice(id, actorOf(auth.user));
    return NextResponse.json({ success: true });
  } catch (e) {
    return purchasingError(e);
  }
}
