import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { IN_TRANSIT_SHIPMENT, pendingShipmentWhere } from '@/lib/shipment-status';

interface Actor { id: string; name: string; role: string }

/**
 * Read-only picture of where every live order stands, so a manager can see on the real data which invoices the old
 * "Pending Shipments" card was counting and whether any invoice's status lags behind its shipment.
 *
 *  - pending:     issued orders whose goods have not left the depot (what the card now counts)
 *  - inTransit:   shipped, delivery not confirmed yet (the old card counted THESE as pending)
 *  - statusBehindShipment: a shipment record exists but the invoice still shows an earlier fulfilment step
 *  - shippedWithoutRecord: the invoice says shipped/delivered but no shipment record exists (reported only - there is
 *    no airway bill to rebuild it from, so it is never invented)
 */
export async function shipmentStatusCheck(depotId?: string) {
  const scope = depotId ? { depotId } : {};
  const [pending, inTransit, behind, noRecord] = await Promise.all([
    prisma.taxInvoice.findMany({
      where: pendingShipmentWhere(depotId) as any,
      select: { invoiceNumber: true, fulfilmentStatus: true, paymentStatus: true, documentStatus: true, depotName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.shipment.findMany({
      where: { ...scope, status: { in: [...IN_TRANSIT_SHIPMENT] as any[] } },
      select: { invoiceNumber: true, status: true, airwayBillNumber: true, dispatchedAt: true, invoice: { select: { fulfilmentStatus: true, paymentStatus: true } } },
      orderBy: { dispatchedAt: 'asc' },
    }),
    prisma.taxInvoice.findMany({
      where: { ...scope, shipment: { isNot: null }, fulfilmentStatus: { notIn: ['SHIPPED', 'DELIVERED', 'CANCELLED'] as any[] } },
      select: { id: true, invoiceNumber: true, fulfilmentStatus: true, paymentStatus: true, shipment: { select: { id: true, status: true, airwayBillNumber: true, dispatchedAt: true } } },
    }),
    prisma.taxInvoice.findMany({
      where: { ...scope, shipment: { is: null }, fulfilmentStatus: { in: ['SHIPPED', 'DELIVERED'] as any[] } },
      select: { invoiceNumber: true, fulfilmentStatus: true, paymentStatus: true },
    }),
  ]);
  return {
    counts: { pending: pending.length, inTransit: inTransit.length, statusBehindShipment: behind.length, shippedWithoutRecord: noRecord.length },
    pending,
    inTransit: inTransit.map((s) => ({ invoiceNumber: s.invoiceNumber, shipmentStatus: s.status, airwayBillNumber: s.airwayBillNumber, dispatchedAt: s.dispatchedAt, fulfilmentStatus: s.invoice?.fulfilmentStatus, paymentStatus: s.invoice?.paymentStatus })),
    statusBehindShipment: behind.map((i) => ({ invoiceNumber: i.invoiceNumber, fulfilmentStatus: i.fulfilmentStatus, paymentStatus: i.paymentStatus, shipmentStatus: i.shipment?.status, airwayBillNumber: i.shipment?.airwayBillNumber, dispatchedAt: i.shipment?.dispatchedAt })),
    shippedWithoutRecord: noRecord,
  };
}

/**
 * Brings an invoice's fulfilment status up to what its shipment record already proves: SHIPPED, or DELIVERED when the
 * shipment is confirmed delivered. Only the status (and the shipment link) changes - no stock movement, no new shipment,
 * no payment or amount change - and each invoice gets its own audit entry. Requires { confirm: true }.
 */
export async function syncStatusesFromShipments(actor: Actor, depotId?: string) {
  const scope = depotId ? { depotId } : {};
  const behind = await prisma.taxInvoice.findMany({
    where: { ...scope, shipment: { isNot: null }, fulfilmentStatus: { notIn: ['SHIPPED', 'DELIVERED', 'CANCELLED'] as any[] } },
    select: { id: true, invoiceNumber: true, fulfilmentStatus: true, depotId: true, depotName: true, shipment: { select: { id: true, status: true, shipmentNumber: true, airwayBillNumber: true } } },
  });
  const fixed: { invoiceNumber: string; from: string; to: string }[] = [];
  for (const inv of behind) {
    if (!inv.shipment) continue;
    const to = inv.shipment.status === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED';
    // conditional on the status we read, so a concurrent change is never overwritten
    const r = await prisma.taxInvoice.updateMany({ where: { id: inv.id, fulfilmentStatus: inv.fulfilmentStatus }, data: { fulfilmentStatus: to as any, shipmentId: inv.shipment.id } });
    if (r.count !== 1) continue;
    fixed.push({ invoiceNumber: inv.invoiceNumber, from: inv.fulfilmentStatus, to });
    await writeAudit(actor, {
      action: 'INVOICE_STATUS_SYNCED_FROM_SHIPMENT', entityType: 'INVOICE', entityId: inv.id, entityLabel: inv.invoiceNumber,
      description: `${inv.invoiceNumber}: fulfilment status ${inv.fulfilmentStatus} -> ${to}, matching shipment ${inv.shipment.shipmentNumber} (AWB ${inv.shipment.airwayBillNumber}, ${inv.shipment.status}). No stock, payment or amount changed.`,
      previousValue: { fulfilmentStatus: inv.fulfilmentStatus }, newValue: { fulfilmentStatus: to },
      depotId: inv.depotId, depotName: inv.depotName,
    });
  }
  return { fixed };
}
