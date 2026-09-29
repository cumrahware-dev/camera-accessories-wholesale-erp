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

    // Only a CONFIRMED proforma may become a tax invoice (Draft/Sent/Cancelled may not).
    if (proforma.status !== 'CONFIRMED') {
      return NextResponse.json(
        {
          error:
            proforma.status === 'CONVERTED'
              ? 'This proforma has already been converted.'
              : `Only a confirmed proforma can be converted (current status: ${String(proforma.status).toLowerCase()}).`,
        },
        { status: 409 }
      );
    }

    // Convert atomically. The status claim (CONFIRMED -> CONVERTED) succeeds for exactly one
    // caller, so double-clicks / concurrent requests cannot create two invoices or burn two
    // invoice numbers. Any failure rolls the whole conversion back; there is no in-memory
    // fallback that could leave a "ghost" invoice behind.
    let invoice: any = null;
    try {
      invoice = await prisma.$transaction(async (tx) => {
        const claim = await tx.proforma.updateMany({
          where: { id: proforma.id, status: 'CONFIRMED' },
          data: { status: 'CONVERTED' },
        });
        if (claim.count !== 1) throw new Error('ALREADY_CONVERTED');

        const settings = await tx.companySettings.update({
          where: { id: 'global-settings' },
          data: { invoiceNextNumber: { increment: 1 } },
        });
        const invoiceNumber = `${settings.invoicePrefix || 'INV-2026-'}${String(settings.invoiceNextNumber - 1).padStart(5, '0')}`;

        const created = await tx.taxInvoice.create({
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
          await tx.invoiceItem.createMany({
            data: proforma.items.map((item: any) => ({
              invoiceId: created.id,
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

        await tx.proforma.update({
          where: { id: proforma.id },
          data: {
            convertedToInvoiceId: created.id,
            convertedToInvoiceNumber: created.invoiceNumber,
            convertedAt: new Date(),
          },
        });

        if (proforma.customerId) {
          await tx.customer.update({
            where: { id: proforma.customerId },
            data: {
              totalOrders: { increment: 1 },
              currentBalance: { increment: proforma.grandTotal || 0 },
            },
          });
        }
        return tx.taxInvoice.findUnique({ where: { id: created.id }, include: { items: true } });
      });
    } catch (dbErr: any) {
      if (dbErr?.message === 'ALREADY_CONVERTED' || dbErr?.code === 'P2002') {
        const fresh = await prisma.proforma.findUnique({ where: { id: proforma.id } }).catch(() => null);
        return NextResponse.json(
          {
            error: `Proforma already converted to ${fresh?.convertedToInvoiceNumber || 'a tax invoice'}`,
            invoiceId: fresh?.convertedToInvoiceId,
          },
          { status: 409 }
        );
      }
      console.error('[Proforma convert] failed:', dbErr);
      return NextResponse.json({ error: 'Conversion failed. Nothing was changed; please try again.' }, { status: 503 });
    }

    // Notify the Depot team (idempotent per invoice + recipient, so retries never double-send).
    triggerInvoiceCreatedDepotEmail(invoice).catch((e) => console.error('[Proforma convert] depot email failed:', e));

    try {
      broadcastSystemEvent({
        type: 'PROFORMA_UPDATED',
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        status: 'CONVERTED',
        data: invoice,
      });
    } catch {}

    return NextResponse.json(invoice, { status: 201 });
  } catch (error: any) {
    console.error('Error converting proforma:', error);
    return NextResponse.json({ error: error.message || 'Conversion failed' }, { status: 500 });
  }
}
