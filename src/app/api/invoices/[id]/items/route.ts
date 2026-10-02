import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * PUT /api/invoices/[id]/items
 * Replaces the line items of a tax invoice that has not entered fulfilment yet:
 *   body: { items: [{ id?: string, productId: string, quantity: number, unitPrice: number }] }
 * - items with an existing `id` are updated, items without one are added, existing items that are not listed are deleted
 * - subtotal / tax / grand total are recomputed on the server; the invoice-level discount % and freight are preserved
 * - allowed only while READY_FOR_PACKING, nothing picked, and no payment recorded
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const incoming: any[] = Array.isArray(body?.items) ? body.items : [];
  if (incoming.length === 0) return NextResponse.json({ error: 'An invoice needs at least one item.' }, { status: 400 });

  const existing = await prisma.taxInvoice.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const denied = assertDepotAccess(auth.user, existing.depotId);
  if (denied) return denied;

  if (existing.fulfilmentStatus !== 'READY_FOR_PACKING') {
    return NextResponse.json({ error: `Items can only be changed before picking starts (this invoice is ${existing.fulfilmentStatus.replace(/_/g, ' ').toLowerCase()}).` }, { status: 409 });
  }
  if (existing.paymentStatus !== 'UNPAID') {
    return NextResponse.json({ error: 'Items cannot be changed after a payment has been recorded.' }, { status: 409 });
  }
  if (existing.items.some((i) => i.isPicked || (i.allocatedSerials || []).length > 0)) {
    return NextResponse.json({ error: 'Some items are already picked, so the invoice can no longer be edited.' }, { status: 409 });
  }

  // validate lines
  const byId = new Map(existing.items.map((i) => [i.id, i]));
  const productIds = Array.from(new Set(incoming.map((l) => String(l.productId || ''))));
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const seenIds = new Set<string>();
  const lines: Array<{ existing?: (typeof existing.items)[number]; product: (typeof products)[number]; quantity: number; unitPrice: number }> = [];
  for (let idx = 0; idx < incoming.length; idx++) {
    const l = incoming[idx];
    const n = idx + 1;
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return NextResponse.json({ error: `Line ${n}: quantity must be a whole number of at least 1.` }, { status: 400 });
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return NextResponse.json({ error: `Line ${n}: enter a valid unit price.` }, { status: 400 });
    const product = productMap.get(String(l.productId));
    if (!product) return NextResponse.json({ error: `Line ${n}: product not found.` }, { status: 400 });
    let ex: (typeof existing.items)[number] | undefined;
    if (l.id) {
      ex = byId.get(String(l.id));
      if (!ex) return NextResponse.json({ error: `Line ${n}: this item no longer exists on the invoice. Reload and try again.` }, { status: 409 });
      if (seenIds.has(ex.id)) return NextResponse.json({ error: `Line ${n}: duplicate item.` }, { status: 400 });
      seenIds.add(ex.id);
      if (ex.productId !== product.id) return NextResponse.json({ error: `Line ${n}: the product of an existing line cannot be swapped. Delete it and add the new product.` }, { status: 400 });
    }
    lines.push({ existing: ex, product, quantity, unitPrice });
  }

  // totals — the invoice-level discount stays the same percentage of the (new) subtotal
  const oldSub = Number(existing.subtotal) || 0;
  const discRatio = oldSub > 0 ? (Number(existing.discountAmount) || 0) / oldSub : 0;
  let subtotal = 0;
  let tax = 0;
  const computed = lines.map((l) => {
    const unchanged = l.existing && l.existing.quantity === l.quantity && Number(l.existing.unitPrice) === l.unitPrice;
    const taxRate = l.existing ? Number(l.existing.taxRate) : Number(l.product.taxRate ?? 5);
    const base = l.quantity * l.unitPrice;
    // untouched lines keep their stored tax/total (they may include a line discount from the proforma)
    const taxAmount = unchanged ? Number(l.existing!.taxAmount) : r2(base * (taxRate / 100));
    const totalPrice = unchanged ? Number(l.existing!.totalPrice) : r2(base + taxAmount);
    subtotal += base;
    tax += taxAmount;
    return { ...l, taxRate, taxAmount, totalPrice };
  });
  subtotal = r2(subtotal);
  tax = r2(tax);
  const discountAmount = r2(subtotal * discRatio);
  const grandTotal = r2(subtotal - discountAmount + tax + (Number(existing.shippingCost) || 0) + (Number(existing.otherCharges) || 0));

  const keepIds = new Set(computed.filter((c) => c.existing).map((c) => c.existing!.id));
  const removedIds = existing.items.filter((i) => !keepIds.has(i.id)).map((i) => i.id);

  try {
    await prisma.$transaction(async (tx) => {
      // re-check inside the transaction so a concurrent pick cannot slip in between
      const fresh = await tx.taxInvoice.findUnique({ where: { id }, select: { fulfilmentStatus: true, paymentStatus: true } });
      if (!fresh || fresh.fulfilmentStatus !== 'READY_FOR_PACKING' || fresh.paymentStatus !== 'UNPAID') throw new Error('STATE_CHANGED');
      if (removedIds.length) await tx.invoiceItem.deleteMany({ where: { id: { in: removedIds }, invoiceId: id } });
      for (const c of computed) {
        if (c.existing) {
          await tx.invoiceItem.update({ where: { id: c.existing.id }, data: { quantity: c.quantity, unitPrice: c.unitPrice, taxAmount: c.taxAmount, totalPrice: c.totalPrice } });
        } else {
          await tx.invoiceItem.create({
            data: {
              invoiceId: id, productId: c.product.id, productSku: c.product.sku, productName: c.product.name, brand: c.product.brand,
              quantity: c.quantity, unitPrice: c.unitPrice, taxRate: c.taxRate, taxAmount: c.taxAmount, totalPrice: c.totalPrice,
              depotId: existing.depotId, depotName: existing.depotName, trackSerial: c.product.trackSerial,
            },
          });
        }
      }
      await tx.taxInvoice.update({ where: { id }, data: { subtotal, discountAmount, taxAmount: tax, grandTotal } });
      // customer balance = sum of unpaid, non-cancelled invoices (same rule as the invoice status sync)
      const open = await tx.taxInvoice.findMany({ where: { customerId: existing.customerId, fulfilmentStatus: { not: 'CANCELLED' }, paymentStatus: { not: 'PAID' } }, select: { grandTotal: true } });
      await tx.customer.update({ where: { id: existing.customerId }, data: { currentBalance: Math.max(0, open.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0)) } });
    });
  } catch (e: any) {
    if (e?.message === 'STATE_CHANGED') return NextResponse.json({ error: 'The invoice moved on while you were editing (picking started or a payment was recorded). Reload the page.' }, { status: 409 });
    console.error('Invoice item update failed:', e);
    return NextResponse.json({ error: 'Could not save the invoice items.' }, { status: 500 });
  }

  const invoice = await prisma.taxInvoice.findUnique({
    where: { id },
    include: { customer: true, depot: true, items: { include: { product: true } }, serialNumbers: true, packingDetails: true, shipment: true },
  });
  return NextResponse.json({ success: true, invoice });
}
