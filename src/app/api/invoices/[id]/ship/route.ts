import { addQty, qtyNum } from '@/lib/quantity';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { triggerShipmentDispatchedManagerEmail } from '@/lib/email-service';
import { trackingUrlFor } from '@/lib/carriers';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.fulfil');
  if (!auth.ok) return auth.response;

  try {
    let existing: any = null;
    try {
      existing = await prisma.taxInvoice.findFirst({
        where: { OR: [{ id }, { invoiceNumber: id }] },
        include: { customer: true, items: true, packingDetails: true, depot: true, shipment: true },
      });
    } catch {}

    if (!existing) {
      existing = dataStore.getInvoiceById(id);
    }

    if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, existing.depotId);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const {
      courier,
      customCourierName,
      carrierId,
      airwayBillNumber,
      trackingUrl,
      weightKg,
      packageCount,
      airwayBillDocUrl,
      remarks,
    } = body;

    if (!airwayBillNumber?.trim()) {
      return NextResponse.json({ error: 'Airway bill number is required to ship an order' }, { status: 400 });
    }
    const finalAWB = airwayBillNumber.trim();

    // A carrier picked from the master (preferred, dynamic) wins over the legacy fixed courier list.
    let carrier: { id: string; name: string; trackingUrlTemplate: string | null } | null = null;
    if (carrierId) {
      carrier = await prisma.carrier.findUnique({ where: { id: String(carrierId) }, select: { id: true, name: true, trackingUrlTemplate: true, isActive: true } as any }) as any;
      if (!carrier) return NextResponse.json({ error: 'The selected carrier no longer exists. Pick another one.' }, { status: 400 });
    }
    const finalCourier = courier || 'DHL_EXPRESS';
    const finalWeight = Number(weightKg) || existing.packingDetails?.totalWeightKg || 0;
    const finalPackages = Number(packageCount) || existing.packingDetails?.packageCount || 1;
    const finalTrackingUrl =
      trackingUrl || (carrier && trackingUrlFor(carrier.trackingUrlTemplate, finalAWB)) || `https://track.courier.com/?awb=${encodeURIComponent(finalAWB)}`;

    // Workflow guard: only a packed order can ship.
    if (existing.fulfilmentStatus !== 'PACKED') {
      const msg: Record<string, string> = {
        SHIPPED: 'This order has already been shipped.',
        DELIVERED: 'This order has already been delivered.',
        CANCELLED: 'This order is cancelled and cannot be shipped.',
      };
      return NextResponse.json(
        { error: msg[existing.fulfilmentStatus] || 'Order must be picked and packed before it can be shipped.' },
        { status: 409 }
      );
    }

    // Everything below is one transaction: the PACKED -> SHIPPED claim succeeds for exactly one
    // request, so double-clicks / repeated calls cannot create a second shipment or deduct stock
    // twice. Insufficient stock rolls the whole dispatch back.
    let updatedInvoice: any = null;
    let shipment: any = null;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const claim = await tx.taxInvoice.updateMany({
          where: { id: existing.id, fulfilmentStatus: 'PACKED' },
          data: { fulfilmentStatus: 'SHIPPED' },
        });
        if (claim.count !== 1) throw new Error('ALREADY_SHIPPED');

        const created = await tx.shipment.create({
          data: {
            shipmentNumber: `SHP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            invoiceId: existing.id,
            invoiceNumber: existing.invoiceNumber,
            customerId: existing.customerId,
            customerName: existing.customerName,
            customerCompany: existing.customerCompany,
            destinationCountry: existing.customer?.country || 'International',
            shippingAddress: existing.shippingAddress,
            depotId: existing.depotId,
            depotName: existing.depotName,
            courier: finalCourier,
            customCourierName: customCourierName || null,
            carrierId: carrier?.id || null,
            carrierName: carrier?.name || null,
            remarks: typeof remarks === 'string' && remarks.trim() ? remarks.trim().slice(0, 1000) : null,
            airwayBillNumber: finalAWB,
            trackingUrl: finalTrackingUrl,
            totalWeightKg: finalWeight,
            packageCount: finalPackages,
            awbDocumentUrl: airwayBillDocUrl || null,
            status: 'DISPATCHED',
          },
        });

        await tx.serialNumber.updateMany({
          where: { OR: [{ invoiceId: existing.id }, { invoiceNumber: existing.invoiceNumber }] },
          data: { status: 'DISPATCHED' },
        });

        // Deduct stock for every product in two statements instead of two per line item. A product that appears on
        // several lines is summed first, so each stock row is touched once. Rule unchanged: a row is only decremented
        // if it holds at least what is needed; if ANY product is short the whole dispatch rolls back.
        const need = new Map<string, number>();
        for (const item of existing.items || []) {
          if (!item.productId || !(qtyNum(item.quantity) > 0)) continue;
          need.set(item.productId, addQty(need.get(item.productId) || 0, item.quantity));
        }
        if (need.size) {
          const values = Prisma.join(Array.from(need, ([pid, q]) => Prisma.sql`(${pid}, ${q}::numeric)`));
          // RETURNING tells us exactly which products had enough stock, so a shortage is reported by name without a second query.
          const updated = await tx.$queryRaw<{ productId: string }[]>`
            UPDATE "DepotInventory" di
               SET quantity = di.quantity - v.q, "availableQuantity" = di."availableQuantity" - v.q
              FROM (VALUES ${values}) AS v(pid, q)
             WHERE di."productId" = v.pid AND di."depotId" = ${existing.depotId} AND di.quantity >= v.q
         RETURNING di."productId" AS "productId"`;
          if (updated.length !== need.size) {
            const ok = new Set(updated.map((r) => r.productId));
            const short = (existing.items || []).find((i: any) => i.productId && need.has(i.productId) && !ok.has(i.productId));
            throw new Error(`INSUFFICIENT_STOCK:${short?.productSku || short?.productName || 'item'}`);
          }
          await tx.$executeRaw`
            UPDATE "Product" p SET "totalStock" = p."totalStock" - v.q
              FROM (VALUES ${values}) AS v(pid, q) WHERE p.id = v.pid`;
          // stock ledger: one SALE_DISPATCH row per product, valued at its current cost
          const costs = await tx.product.findMany({ where: { id: { in: Array.from(need.keys()) } }, select: { id: true, sku: true, name: true, purchasePrice: true } });
          await tx.stockTransaction.createMany({
            data: costs.map((p) => ({
              type: 'SALE_DISPATCH' as const, productId: p.id, productSku: p.sku, productName: p.name, sourceDepotId: existing.depotId, sourceDepotName: existing.depotName,
              quantity: need.get(p.id)!, unitCost: p.purchasePrice || 0, referenceNumber: existing.invoiceNumber, notes: `Dispatched to ${existing.customerCompany || existing.customerName} (AWB ${finalAWB})`, createdBy: auth.user.name,
            })),
          });
        }

        const invoice = await tx.taxInvoice.update({
          where: { id: existing.id },
          data: { shipmentId: created.id },
          include: { items: true, packingDetails: true, customer: true, depot: true, shipment: true, serialNumbers: true },
        });
        return { created, invoice };
      }, { maxWait: 10_000, timeout: 30_000 });
      shipment = result.created;
      updatedInvoice = result.invoice;
    } catch (dbErr: any) {
      const m = String(dbErr?.message || '');
      if (m === 'ALREADY_SHIPPED') {
        return NextResponse.json({ error: 'This order has already been shipped.' }, { status: 409 });
      }
      if (m.startsWith('INSUFFICIENT_STOCK:')) {
        return NextResponse.json(
          { error: `Insufficient stock at this depot for ${m.split(':')[1]}. Adjust inventory before shipping.` },
          { status: 409 }
        );
      }
      console.error('[Ship] failed:', dbErr);
      return NextResponse.json({ error: 'Dispatch failed. Nothing was changed; please try again.' }, { status: 503 });
    }

    triggerShipmentDispatchedManagerEmail(shipment, updatedInvoice).catch((e) =>
      console.error('[Ship] manager email failed:', e)
    );

    return NextResponse.json({
      success: true,
      message: 'Order dispatched successfully',
      invoice: updatedInvoice,
      shipment,
    });
  } catch (error: any) {
    console.error('Error in dispatch API:', error);
    return NextResponse.json({ error: error?.message || 'Dispatch failed' }, { status: 500 });
  }
}
