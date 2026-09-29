import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { triggerShipmentDispatchedManagerEmail } from '@/lib/email-service';

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
      airwayBillNumber,
      trackingUrl,
      weightKg,
      packageCount,
      airwayBillDocUrl,
    } = body;

    if (!airwayBillNumber?.trim()) {
      return NextResponse.json({ error: 'Airway bill number is required to ship an order' }, { status: 400 });
    }
    const finalAWB = airwayBillNumber.trim();
    const finalCourier = courier || 'DHL_EXPRESS';
    const finalWeight = Number(weightKg) || existing.packingDetails?.totalWeightKg || 0;
    const finalPackages = Number(packageCount) || existing.packingDetails?.packageCount || 1;
    const finalTrackingUrl =
      trackingUrl || `https://track.courier.com/?awb=${encodeURIComponent(finalAWB)}`;

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

        for (const item of existing.items || []) {
          if (!item.productId || !(item.quantity > 0)) continue;
          const dec = await tx.depotInventory.updateMany({
            where: {
              productId: item.productId,
              depotId: existing.depotId,
              quantity: { gte: item.quantity },
            },
            data: {
              quantity: { decrement: item.quantity },
              availableQuantity: { decrement: item.quantity },
            },
          });
          if (dec.count !== 1) throw new Error(`INSUFFICIENT_STOCK:${item.productSku || item.productName}`);
          await tx.product.update({
            where: { id: item.productId },
            data: { totalStock: { decrement: item.quantity } },
          });
        }

        const invoice = await tx.taxInvoice.update({
          where: { id: existing.id },
          data: { shipmentId: created.id },
          include: { items: true, packingDetails: true, customer: true, depot: true, shipment: true, serialNumbers: true },
        });
        return { created, invoice };
      });
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
