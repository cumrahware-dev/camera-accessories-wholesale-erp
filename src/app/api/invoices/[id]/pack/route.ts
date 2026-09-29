import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.fulfil');
  if (!auth.ok) return auth.response;

  try {
    let invoice: any = null;
    try {
      invoice = await prisma.taxInvoice.findFirst({
        where: { OR: [{ id }, { invoiceNumber: id }] },
        include: { customer: true, depot: true, items: true },
      });
    } catch {}

    if (!invoice) {
      invoice = dataStore.getInvoiceById(id);
    }

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, invoice.depotId);
    if (denied) return denied;

    // Workflow guard: only a picked order (PROCESSING) can be packed.
    if (invoice.fulfilmentStatus !== 'PROCESSING') {
      const msg: Record<string, string> = {
        READY_FOR_PACKING: 'Order must be picked before it can be packed.',
        PACKED: 'This order has already been packed.',
        SHIPPED: 'This order has already been shipped.',
        DELIVERED: 'This order has already been delivered.',
        CANCELLED: 'This order is cancelled and cannot be packed.',
      };
      return NextResponse.json({ error: msg[invoice.fulfilmentStatus] || 'Order is not ready to pack.' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const { packedBy, packageCount, totalWeightKg, dimensionsCm, packagePhotoUrl, notes } = body;

    let packedInvoice: any = null;
    try {
      packedInvoice = await prisma.taxInvoice.update({
        where: { id: invoice.id, fulfilmentStatus: 'PROCESSING' },
        data: {
          fulfilmentStatus: 'PACKED',
          packingDetails: {
            upsert: {
              create: {
                packedBy: packedBy || auth.user.name || 'Depot Staff',
                packageCount: Math.max(1, Number(packageCount) || 1),
                totalWeightKg: Math.max(0.1, Number(totalWeightKg) || 1.0),
                lengthCm: Number(dimensionsCm?.length) || 30,
                widthCm: Number(dimensionsCm?.width) || 25,
                heightCm: Number(dimensionsCm?.height) || 20,
                packagePhotoUrl: packagePhotoUrl || null,
                packingNotes: notes || null,
              },
              update: {
                packedBy: packedBy || auth.user.name || 'Depot Staff',
                packageCount: Math.max(1, Number(packageCount) || 1),
                totalWeightKg: Math.max(0.1, Number(totalWeightKg) || 1.0),
                lengthCm: Number(dimensionsCm?.length) || 30,
                widthCm: Number(dimensionsCm?.width) || 25,
                heightCm: Number(dimensionsCm?.height) || 20,
                ...(packagePhotoUrl ? { packagePhotoUrl } : {}),
                packingNotes: notes || null,
              },
            },
          },
        },
        include: { items: true, packingDetails: true, customer: true, depot: true },
      });
    } catch (dbErr: any) {
      if (dbErr?.code === 'P2025') {
        return NextResponse.json({ error: 'This order has already been packed.' }, { status: 409 });
      }
      dataStore.packInvoice(invoice.id);
      packedInvoice = dataStore.getInvoiceById(invoice.id);
    }

    if (!packedInvoice) {
      dataStore.packInvoice(invoice.id);
      packedInvoice = dataStore.getInvoiceById(invoice.id);
    }

    return NextResponse.json({
      success: true,
      message: 'Order packed successfully and marked READY FOR DISPATCH',
      invoice: packedInvoice,
    });
  } catch (error: any) {
    console.error('Error in packing API:', error);
    return NextResponse.json({ error: error?.message || 'Packing failed' }, { status: 400 });
  }
}
