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

    const finalAWB = airwayBillNumber?.trim() || `AWB-${Date.now()}`;
    const finalCourier = courier || 'DHL_EXPRESS';
    const finalWeight = Number(weightKg) || existing.packingDetails?.totalWeightKg || 5.0;
    const finalPackages = Number(packageCount) || existing.packingDetails?.packageCount || 1;
    const finalTrackingUrl =
      trackingUrl || `https://track.courier.com/?awb=${encodeURIComponent(finalAWB)}`;

    let updatedInvoice: any = null;
    let shipment: any = null;

    try {
      const shipmentNumber = `SHP-${Date.now()}`;
      shipment = await prisma.shipment.create({
        data: {
          shipmentNumber,
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

      // 1. Transition all allocated serial numbers to DISPATCHED
      await prisma.serialNumber.updateMany({
        where: {
          OR: [
            { invoiceId: existing.id },
            { invoiceNumber: existing.invoiceNumber },
          ],
        },
        data: { status: 'DISPATCHED' },
      });

      for (const item of (existing.items || [])) {
        if (Array.isArray(item.allocatedSerials)) {
          for (const s of item.allocatedSerials) {
            await prisma.serialNumber.updateMany({
              where: { serialNumber: s },
              data: { status: 'DISPATCHED' },
            }).catch(() => {});
            dataStore.updateSerialNumberStatus(s, 'DISPATCHED');
          }
        }
      }

      dataStore.getSerialNumbers().forEach((s) => {
        if (s.invoiceId === existing.id || s.invoiceNumber === existing.invoiceNumber) {
          s.status = 'DISPATCHED';
        }
      });

      // 2. Decrement depot inventory and total stock for each invoice item
      for (const item of (existing.items || [])) {
        if (item.productId && item.quantity > 0) {
          try {
            await prisma.depotInventory.updateMany({
              where: {
                productId: item.productId,
                depotId: existing.depotId,
              },
              data: {
                quantity: { decrement: item.quantity },
                availableQuantity: { decrement: item.quantity },
              },
            });
            await prisma.product.update({
              where: { id: item.productId },
              data: {
                totalStock: { decrement: item.quantity },
              },
            });
          } catch {}
        }
      }

      updatedInvoice = await prisma.taxInvoice.update({
        where: { id: existing.id },
        data: { fulfilmentStatus: 'SHIPPED', shipmentId: shipment.id },
        include: { items: true, packingDetails: true, customer: true, depot: true, shipment: true, serialNumbers: true },
      });
    } catch (dbErr) {
      // Fallback to dataStore
      dataStore.dispatchShipment(existing.id);
      shipment = dataStore.createShipment({
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        depotId: existing.depotId,
        depotName: existing.depotName,
        courier: finalCourier,
        airwayBillNumber: finalAWB,
        trackingUrl: finalTrackingUrl,
        totalWeightKg: finalWeight,
        packageCount: finalPackages,
        awbDocumentUrl: airwayBillDocUrl,
        status: 'DISPATCHED',
      });
      updatedInvoice = dataStore.getInvoiceById(existing.id);
    }

    if (!updatedInvoice) {
      dataStore.dispatchShipment(existing.id);
      updatedInvoice = dataStore.getInvoiceById(existing.id);
    }

    if (shipment) {
      triggerShipmentDispatchedManagerEmail(shipment, updatedInvoice || existing);
    }

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
