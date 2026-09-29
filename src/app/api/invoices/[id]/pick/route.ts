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
        include: {
          items: { include: { product: true } },
          customer: true,
          depot: true,
        },
      });
    } catch {}

    if (!invoice) {
      invoice = dataStore.getInvoiceById(id);
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const denied = assertDepotAccess(auth.user, invoice.depotId);
    if (denied) return denied;

    if (invoice.fulfilmentStatus === 'SHIPPED' || invoice.fulfilmentStatus === 'DELIVERED') {
      return NextResponse.json(
        { error: 'Order has already been dispatched/delivered.' },
        { status: 409 }
      );
    }

    if (invoice.fulfilmentStatus === 'PACKED') {
      return NextResponse.json({ error: 'Order has already been packed.' }, { status: 409 });
    }

    if (invoice.fulfilmentStatus === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Order has been cancelled and cannot be picked.' },
        { status: 400 }
      );
    }

    // Inventory availability: refuse to pick what the depot does not have.
    if (invoice.fulfilmentStatus === 'READY_FOR_PACKING' && Array.isArray(invoice.items)) {
      for (const item of invoice.items) {
        if (!item.productId || !(item.quantity > 0)) continue;
        const inv = await prisma.depotInventory
          .findUnique({ where: { productId_depotId: { productId: item.productId, depotId: invoice.depotId } } })
          .catch(() => null);
        if (!inv || inv.availableQuantity < item.quantity) {
          return NextResponse.json(
            {
              error: `Insufficient stock for ${item.productSku || item.productName}: need ${item.quantity}, available ${inv?.availableQuantity ?? 0}.`,
            },
            { status: 409 }
          );
        }
      }
    }

    const body = await req.json().catch(() => ({}));
    const { serials, allocatedSerials, itemPicks } = body;

    // Collect all requested serial numbers
    const requestedSerials: string[] = [];
    if (Array.isArray(serials)) requestedSerials.push(...serials);
    if (Array.isArray(allocatedSerials)) requestedSerials.push(...allocatedSerials);
    if (Array.isArray(itemPicks)) {
      for (const ip of itemPicks) {
        if (Array.isArray(ip.serials)) requestedSerials.push(...ip.serials);
        if (Array.isArray(ip.allocatedSerials)) requestedSerials.push(...ip.allocatedSerials);
      }
    }

    // Validate serial numbers if provided
    if (requestedSerials.length > 0) {
      // Check for duplicate serial inputs
      const uniqueInputSerials = new Set(requestedSerials);
      if (uniqueInputSerials.size !== requestedSerials.length) {
        return NextResponse.json(
          { error: 'Duplicate serial numbers specified in pick request.' },
          { status: 400 }
        );
      }

      for (const sn of requestedSerials) {
        let found: any = await prisma.serialNumber.findUnique({
          where: { serialNumber: sn },
        }).catch(() => null);

        if (!found) {
          found = dataStore.getSerialNumbers().find((s) => s.serialNumber === sn);
        }

        if (!found) {
          return NextResponse.json(
            { error: `Serial number "${sn}" does not exist in registry.` },
            { status: 400 }
          );
        }

        if (found.depotId && invoice.depotId && found.depotId !== invoice.depotId) {
          return NextResponse.json(
            { error: `Serial number "${sn}" is located at a different depot.` },
            { status: 400 }
          );
        }

        if (found.status !== 'IN_STOCK' && found.invoiceId !== invoice.id) {
          return NextResponse.json(
            { error: `Serial number "${sn}" is currently in status ${found.status} and cannot be allocated.` },
            { status: 400 }
          );
        }
      }

      // Mark serials as ALLOCATED
      for (const sn of requestedSerials) {
        await prisma.serialNumber.update({
          where: { serialNumber: sn },
          data: {
            status: 'ALLOCATED',
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
          },
        }).catch(() => {});
        dataStore.updateSerialNumberStatus(sn, 'ALLOCATED', invoice.id, invoice.invoiceNumber);
      }

      // Also persist allocated serials on invoice item
      if (invoice.items && invoice.items.length > 0) {
        await prisma.invoiceItem.update({
          where: { id: invoice.items[0].id },
          data: {
            allocatedSerials: requestedSerials,
            isPicked: true,
          },
        }).catch(() => {});
      }
    }

    let updatedInvoice: any = null;
    try {
      updatedInvoice = await prisma.taxInvoice.update({
        where: { id: invoice.id },
        data: { fulfilmentStatus: 'PROCESSING' },
        include: { items: true, customer: true, depot: true, packingDetails: true, serialNumbers: true },
      });
    } catch (dbErr) {
      dataStore.pickInvoiceItems(invoice.id);
      updatedInvoice = dataStore.getInvoiceById(invoice.id);
    }

    if (!updatedInvoice) {
      dataStore.pickInvoiceItems(invoice.id);
      updatedInvoice = dataStore.getInvoiceById(invoice.id);
    }

    return NextResponse.json({
      success: true,
      message: 'Picking confirmed successfully',
      invoice: updatedInvoice,
    });
  } catch (error: any) {
    console.error('Error in picking API:', error);
    return NextResponse.json({ error: error?.message || 'Failed to complete picking operation' }, { status: 500 });
  }
}
