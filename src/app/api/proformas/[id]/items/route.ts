import { NextRequest, NextResponse } from 'next/server';
import { effectiveProductRate, getDefaultTax } from '@/lib/tax';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * PUT /api/proformas/[id]/items — replace the line items of a DRAFT proforma.
 *   body: { items: [{ id?: string, productId: string, quantity: number, unitPrice: number }] }
 * Lines with an `id` are updated, lines without one are added, existing lines not listed are deleted.
 * Totals are recalculated here with the same rules as proforma creation; the discount % and freight are kept.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'proformas.write');
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  const incoming: any[] = Array.isArray(body?.items) ? body.items : [];
  if (incoming.length === 0) return NextResponse.json({ error: 'A proforma needs at least one item.' }, { status: 400 });

  const existing = await prisma.proforma.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return NextResponse.json({ error: 'Proforma not found.' }, { status: 404 });
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: `Items can only be changed while the proforma is a draft (this one is ${String(existing.status).toLowerCase()}).` }, { status: 409 });
  }

  const byId = new Map(existing.items.map((i) => [i.id, i]));
  const products = await prisma.product.findMany({ where: { id: { in: Array.from(new Set(incoming.map((l) => String(l.productId || '')))) } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const defaultTax = await getDefaultTax();
  const seen = new Set<string>();
  const lines: any[] = [];
  for (let idx = 0; idx < incoming.length; idx++) {
    const l = incoming[idx];
    const n = idx + 1;
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return NextResponse.json({ error: `Line ${n}: quantity must be a whole number of at least 1.` }, { status: 400 });
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return NextResponse.json({ error: `Line ${n}: enter a valid unit price.` }, { status: 400 });
    const product = productMap.get(String(l.productId));
    if (!product) return NextResponse.json({ error: `Line ${n}: product not found.` }, { status: 400 });
    let ex: any;
    if (l.id) {
      ex = byId.get(String(l.id));
      if (!ex) return NextResponse.json({ error: `Line ${n}: this item no longer exists. Reload and try again.` }, { status: 409 });
      if (seen.has(ex.id)) return NextResponse.json({ error: `Line ${n}: duplicate item.` }, { status: 400 });
      seen.add(ex.id);
      if (ex.productId !== product.id) return NextResponse.json({ error: `Line ${n}: the product of an existing line cannot be swapped. Delete it and add the new product.` }, { status: 400 });
    }
    lines.push({ ex, product, quantity, unitPrice });
  }

  let subtotal = 0;
  let lineDisc = 0;
  let tax = 0;
  const computed = lines.map((l) => {
    const taxRate = l.ex ? Number(l.ex.taxRate) : effectiveProductRate(l.product, defaultTax);
    const disc = l.ex ? Number(l.ex.discountPercent) || 0 : 0;
    const itemSub = l.quantity * l.unitPrice * (1 - disc / 100);
    const taxAmount = r2(itemSub * (taxRate / 100));
    subtotal += l.quantity * l.unitPrice;
    lineDisc += l.quantity * l.unitPrice - itemSub;
    tax += taxAmount;
    return { ...l, taxRate, disc, taxAmount, totalPrice: r2(itemSub + taxAmount) };
  });
  subtotal = r2(subtotal);
  tax = r2(tax);
  // same rule as computeDocumentTotals: line discounts + the document % of the discounted lines
  const discountAmount = r2(lineDisc + ((subtotal - lineDisc) * (Number(existing.discountPercent) || 0)) / 100);
  const grandTotal = r2(subtotal - discountAmount + tax + (Number(existing.shippingCost) || 0) + (Number((existing as any).otherCharges) || 0));
  const keep = new Set(computed.filter((c) => c.ex).map((c) => c.ex.id));
  const removed = existing.items.filter((i) => !keep.has(i.id)).map((i) => i.id);

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.proforma.findUnique({ where: { id }, select: { status: true } });
      if (!fresh || fresh.status !== 'DRAFT') throw new Error('STATE_CHANGED');
      if (removed.length) await tx.proformaItem.deleteMany({ where: { id: { in: removed }, proformaId: id } });
      for (const c of computed) {
        if (c.ex) {
          await tx.proformaItem.update({ where: { id: c.ex.id }, data: { quantity: c.quantity, unitPrice: c.unitPrice, taxAmount: c.taxAmount, totalPrice: c.totalPrice } });
        } else {
          const depot = existing.items[0];
          await tx.proformaItem.create({
            data: {
              proformaId: id, productId: c.product.id, productSku: c.product.sku, productName: c.product.name, brand: c.product.brand,
              quantity: c.quantity, unitPrice: c.unitPrice, discountPercent: 0, taxRate: c.taxRate, taxAmount: c.taxAmount, totalPrice: c.totalPrice,
              selectedDepotId: depot?.selectedDepotId ?? null, selectedDepotName: depot?.selectedDepotName ?? null, trackSerial: c.product.trackSerial,
            },
          });
        }
      }
      await tx.proforma.update({ where: { id }, data: { subtotal, discountAmount, taxAmount: tax, grandTotal } });
    });
  } catch (e: any) {
    if (e?.message === 'STATE_CHANGED') return NextResponse.json({ error: 'This proforma is no longer a draft. Reload the page.' }, { status: 409 });
    console.error('Proforma item update failed:', e);
    return NextResponse.json({ error: 'Could not save the proforma items.' }, { status: 500 });
  }

  const proforma = await prisma.proforma.findUnique({ where: { id }, include: { customer: true, items: { include: { product: true } } } });
  return NextResponse.json({ success: true, invoice: proforma, proforma });
}
