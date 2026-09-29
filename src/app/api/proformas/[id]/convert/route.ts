import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { deductStockForInvoice } from '@/lib/inventory-service';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { guardApi } from '@/lib/api-auth';
import { triggerInvoiceCreatedDepotEmail } from '@/lib/email-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { depotId } = body;

    // Get the proforma by ID or proformaNumber
    let proforma: any = null;
    try {
      proforma = await prisma.proforma.findUnique({
        where: { id },
        include: { items: true, customer: true },
      });

      if (!proforma) {
        proforma = await prisma.proforma.findUnique({
          where: { proformaNumber: id },
          include: { items: true, customer: true },
        });
      }
    } catch (dbErr) {}

    if (!proforma) {
      proforma = dataStore.getProformaById(id);
    }

    if (!proforma) {
      return NextResponse.json({ error: 'Proforma not found' }, { status: 404 });
    }

    if (proforma.status === 'CONVERTED' && (proforma as any).convertedToInvoiceId) {
      return NextResponse.json({
        error: `Proforma already converted to ${(proforma as any).convertedToInvoiceNumber || 'a tax invoice'}`,
        invoiceId: (proforma as any).convertedToInvoiceId,
      }, { status: 409 });
    }

    const finalDepotId = depotId || 'dep-central';
    const depot = dataStore.getDepotById(finalDepotId);
    const finalDepotName = depot?.name || 'Central Depot';

    // Attempt DB conversion
    let invoice: any = null;
    try {
      const settings = await prisma.companySettings.findUnique({
        where: { id: 'global-settings' },
      });
      const nextNumber = settings?.invoiceNextNumber || 1;
      const invoiceNumber = `${settings?.invoicePrefix || 'INV-2026-'}${String(nextNumber).padStart(5, '0')}`;

      invoice = await prisma.taxInvoice.create({
        data: {
          invoiceNumber,
          customerId: proforma.customerId,
          customerName: proforma.customerName,
          customerEmail: proforma.customerEmail,
          customerCompany: proforma.customerCompany,
          customerPhone: proforma.customerPhone,
          billingAddress: proforma.billingAddress,
          shippingAddress: proforma.shippingAddress,
          depotId: finalDepotId,
          depotName: finalDepotName,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          paymentTerms: proforma.paymentTerms,
          paymentStatus: 'UNPAID',
          fulfilmentStatus: 'READY_FOR_PACKING',
          notes: proforma.notes,
          subtotal: proforma.subtotal,
          discountAmount: proforma.discountAmount,
          taxAmount: proforma.taxAmount,
          shippingCost: proforma.shippingCost,
          grandTotal: proforma.grandTotal,
          actualWeightKg: proforma.actualWeightKg,
          volumetricWeightKg: proforma.volumetricWeightKg,
          chargeableWeightKg: proforma.chargeableWeightKg,
          freightRatePerKg: proforma.freightRatePerKg,
          freightCharge: proforma.freightCharge,
          additionalFreightCharges: proforma.additionalFreightCharges,
          freightVolumetricDivisor: proforma.freightVolumetricDivisor,
          freightIsManualOverride: proforma.freightIsManualOverride,
          freightAllocationMethod: proforma.freightAllocationMethod,
          proformaId: proforma.id,
          proformaNumber: proforma.proformaNumber,
        },
      });

      if (Array.isArray(proforma.items) && proforma.items.length > 0) {
        await prisma.invoiceItem.createMany({
          data: proforma.items.map((item: any) => ({
            invoiceId: invoice.id,
            productId: item.productId,
            productSku: item.productSku,
            productName: item.productName,
            brand: item.brand,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            taxAmount: item.taxAmount,
            totalPrice: item.totalPrice,
            depotId: item.selectedDepotId || finalDepotId,
            depotName: item.selectedDepotName || finalDepotName,
            trackSerial: item.trackSerial,
            unitWeightKg: item.unitWeightKg || 0,
            lengthCm: item.lengthCm || 0,
            widthCm: item.widthCm || 0,
            heightCm: item.heightCm || 0,
            allocatedFreight: item.allocatedFreight || 0,
          })),
        });
      }

      await prisma.proforma.update({
        where: { id: proforma.id },
        data: {
          status: 'CONVERTED',
          convertedToInvoiceId: invoice.id,
          convertedToInvoiceNumber: invoice.invoiceNumber,
          convertedAt: new Date(),
        },
      });

      await prisma.companySettings.update({
        where: { id: 'global-settings' },
        data: { invoiceNextNumber: nextNumber + 1 },
      }).catch(() => {});

      if (proforma.customerId) {
        await prisma.customer.update({
          where: { id: proforma.customerId },
          data: {
            totalOrders: { increment: 1 },
            currentBalance: { increment: proforma.grandTotal || 0 },
          },
        }).catch(() => {});
      }
    } catch (dbErr) {
      // Fallback to dataStore
      invoice = dataStore.createInvoice({
        proformaId: proforma.id,
        proformaNumber: proforma.proformaNumber,
        customerId: proforma.customerId,
        customerName: proforma.customerName,
        customerCompany: proforma.customerCompany,
        customerEmail: proforma.customerEmail,
        customerPhone: proforma.customerPhone,
        billingAddress: proforma.billingAddress,
        shippingAddress: proforma.shippingAddress,
        depotId: finalDepotId,
        depotName: finalDepotName,
        paymentTerms: proforma.paymentTerms,
        subtotal: proforma.subtotal,
        discountAmount: proforma.discountAmount,
        taxAmount: proforma.taxAmount,
        shippingCost: proforma.shippingCost,
        grandTotal: proforma.grandTotal,
        actualWeightKg: proforma.actualWeightKg,
        volumetricWeightKg: proforma.volumetricWeightKg,
        chargeableWeightKg: proforma.chargeableWeightKg,
        freightRatePerKg: proforma.freightRatePerKg,
        freightCharge: proforma.freightCharge,
        additionalFreightCharges: proforma.additionalFreightCharges,
        freightVolumetricDivisor: proforma.freightVolumetricDivisor,
        freightIsManualOverride: proforma.freightIsManualOverride,
        freightAllocationMethod: proforma.freightAllocationMethod,
        items: proforma.items,
        notes: proforma.notes,
      });

      dataStore.updateProforma(proforma.id, {
        status: 'CONVERTED',
        convertedToInvoiceId: invoice.id,
        convertedToInvoiceNumber: invoice.invoiceNumber,
      } as any);
    }

    try {
      broadcastSystemEvent({
        type: 'PROFORMA_UPDATED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: 'CONVERTED',
        data: invoice,
      });
    } catch {}

    if (invoice) {
      // The Prisma create() above doesn't include items (they're written via
      // a separate createMany), so pass the proforma's items through for the
      // email template — the dataStore fallback path already embeds them.
      triggerInvoiceCreatedDepotEmail({ ...invoice, items: invoice.items || proforma.items });
    }

    return NextResponse.json(invoice, { status: 201 });
  } catch (error: any) {
    console.error('Error converting proforma:', error);
    return NextResponse.json({ error: error.message || 'Conversion failed' }, { status: 500 });
  }
}
