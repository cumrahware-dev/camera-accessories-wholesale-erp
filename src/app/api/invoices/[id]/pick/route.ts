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

    // The request body is read first so every independent database read below can run together (one round trip)
    // instead of one query per line item / per serial number.
    const body = await req.json().catch(() => ({}));
    const { serials, allocatedSerials, itemPicks } = body;

    const requestedSerials: string[] = [];
    if (Array.isArray(serials)) requestedSerials.push(...serials);
    if (Array.isArray(allocatedSerials)) requestedSerials.push(...allocatedSerials);
    if (Array.isArray(itemPicks)) {
      for (const ip of itemPicks) {
        if (Array.isArray(ip.serials)) requestedSerials.push(...ip.serials);
        if (Array.isArray(ip.allocatedSerials)) requestedSerials.push(...ip.allocatedSerials);
      }
    }
    if (requestedSerials.length > 0 && new Set(requestedSerials).size !== requestedSerials.length) {
      return NextResponse.json({ error: 'Duplicate serial numbers specified in pick request.' }, { status: 400 });
    }

    const needsStockCheck = invoice.fulfilmentStatus === 'READY_FOR_PACKING' && Array.isArray(invoice.items);
    const stockLines = needsStockCheck ? invoice.items.filter((i: any) => i.productId && i.quantity > 0) : [];
    const [stockRows, serialRows] = await Promise.all([
      stockLines.length
        ? prisma.depotInventory
            .findMany({ where: { depotId: invoice.depotId, productId: { in: stockLines.map((i: any) => i.productId) } }, select: { productId: true, availableQuantity: true } })
            .catch(() => [] as { productId: string; availableQuantity: number }[])
        : Promise.resolve([] as { productId: string; availableQuantity: number }[]),
      requestedSerials.length
        ? prisma.serialNumber.findMany({ where: { serialNumber: { in: requestedSerials } } }).catch(() => [] as any[])
        : Promise.resolve([] as any[]),
    ]);

    // Inventory availability: refuse to pick what the depot does not have.
    const availableByProduct = new Map(stockRows.map((r) => [r.productId, r.availableQuantity]));
    for (const item of stockLines) {
      const available = availableByProduct.get(item.productId);
      if (available === undefined || available < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for ${item.productSku || item.productName}: need ${item.quantity}, available ${available ?? 0}.` },
          { status: 409 }
        );
      }
    }

    // Validate serial numbers if provided
    const foundBySerial = new Map<string, any>(serialRows.map((r: any) => [r.serialNumber, r]));
    const dbSerials: string[] = [];
    for (const sn of requestedSerials) {
      let found: any = foundBySerial.get(sn);
      if (found) dbSerials.push(sn);
      if (!found) {
        found = dataStore.getSerialNumbers().find((s) => s.serialNumber === sn);
      }
      if (!found) {
        return NextResponse.json({ error: `Serial number "${sn}" does not exist in registry.` }, { status: 400 });
      }
      if (found.depotId && invoice.depotId && found.depotId !== invoice.depotId) {
        return NextResponse.json({ error: `Serial number "${sn}" is located at a different depot.` }, { status: 400 });
      }
      if (found.status !== 'IN_STOCK' && found.invoiceId !== invoice.id) {
        return NextResponse.json({ error: `Serial number "${sn}" is currently in status ${found.status} and cannot be allocated.` }, { status: 400 });
      }
    }

    const invoiceInclude = { items: true, customer: true, depot: true, packingDetails: true, serialNumbers: true } as const;
    let updatedInvoice: any = null;

    if (requestedSerials.length > 0) {
      // All-or-nothing: claim every serial in ONE statement, and only those still free (IN_STOCK, or already ours).
      // If somebody else took one between our check and now, fewer rows match, the transaction rolls back and the
      // pick is refused: no serial is left half-allocated and none can be allocated to two orders.
      try {
        await prisma.$transaction(
          async (tx) => {
            if (dbSerials.length) {
              const r = await tx.serialNumber.updateMany({
                where: { serialNumber: { in: dbSerials }, OR: [{ status: 'IN_STOCK' }, { invoiceId: invoice.id }] },
                data: { status: 'ALLOCATED', invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
              });
              if (r.count !== dbSerials.length) throw Object.assign(new Error('SERIAL_TAKEN'), { code: 'SERIAL_TAKEN' });
            }
            // Also persist allocated serials on invoice item
            if (invoice.items && invoice.items.length > 0) {
              await tx.invoiceItem.update({ where: { id: invoice.items[0].id }, data: { allocatedSerials: requestedSerials, isPicked: true } });
            }
            // the status change rides in the same transaction: one BEGIN/COMMIT for the whole pick
            updatedInvoice = await tx.taxInvoice.update({ where: { id: invoice.id }, data: { fulfilmentStatus: 'PROCESSING' }, include: invoiceInclude });
          },
          { maxWait: 10_000, timeout: 30_000 }
        );
      } catch (e: any) {
        if (e?.code === 'SERIAL_TAKEN') {
          return NextResponse.json({ error: 'One of these serial numbers was just allocated to another order. Refresh and scan again.' }, { status: 409 });
        }
        throw e;
      }
      for (const sn of requestedSerials) dataStore.updateSerialNumberStatus(sn, 'ALLOCATED', invoice.id, invoice.invoiceNumber);
    }

    try {
      if (!updatedInvoice) {
        updatedInvoice = await prisma.taxInvoice.update({
          where: { id: invoice.id },
          data: { fulfilmentStatus: 'PROCESSING' },
          include: invoiceInclude,
        });
      }
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
