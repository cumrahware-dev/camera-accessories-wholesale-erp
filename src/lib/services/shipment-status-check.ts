import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { IN_TRANSIT_SHIPMENT, ORDER_STATE_LABEL, classifyOrder, inTransitShipmentWhere, pendingShipmentWhere } from '@/lib/shipment-status';

interface Actor { id: string; name: string; role: string }

const text = (q?: string) => (q || '').trim().slice(0, 80);
/** invoice number or customer name / company contains the text (case-insensitive) */
const matching = (q?: string) => {
  const t = text(q);
  return t ? { OR: [{ invoiceNumber: { contains: t, mode: 'insensitive' as const } }, { customerName: { contains: t, mode: 'insensitive' as const } }, { customerCompany: { contains: t, mode: 'insensitive' as const } }] } : {};
};

/**
 * Read-only picture of where every live order stands, so a manager can see on the real data which invoices the old
 * "Pending Shipments" card was counting and whether any invoice's status lags behind its shipment.
 *
 *  - pending:      issued orders whose goods have not left the depot (what the card counts)
 *  - inTransit:    shipped, delivery not confirmed yet (the old card counted THESE as pending)
 *  - statusBehindShipment: a shipment record proves more than the invoice says (shipped / delivered)
 *  - deliveredButShipmentOpen: the invoice says delivered but its shipment record does not (reported only)
 *  - shippedWithoutRecord: the invoice says shipped/delivered but no shipment record exists (reported only - there is
 *    no airway bill to rebuild it from, so it is never invented)
 *
 * `q` narrows every list to an invoice number or a customer name (e.g. "Tanweer"). `numbers` additionally classifies the
 * named invoices one by one, with the same rule the dashboard filters implement.
 */
export async function shipmentStatusCheck(depotId?: string, opts: { q?: string; numbers?: string[] } = {}) {
  const scope = { ...(depotId ? { depotId } : {}), ...matching(opts.q) };
  const sel = { invoiceNumber: true, customerName: true, customerCompany: true, fulfilmentStatus: true, paymentStatus: true, documentStatus: true } as const;
  const [pending, inTransit, behind, deliveredOpen, noRecord, named] = await Promise.all([
    prisma.taxInvoice.findMany({ where: { ...pendingShipmentWhere(depotId), ...matching(opts.q) } as any, select: { ...sel, depotName: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.shipment.findMany({
      where: { ...inTransitShipmentWhere(depotId), ...(text(opts.q) ? { invoice: { is: { ...matching(opts.q), documentStatus: { not: 'CANCELLED' }, fulfilmentStatus: { not: 'CANCELLED' } } } } : {}) } as any,
      select: { invoiceNumber: true, status: true, airwayBillNumber: true, dispatchedAt: true, invoice: { select: sel } },
      orderBy: { dispatchedAt: 'asc' },
    }),
    prisma.taxInvoice.findMany({
      where: {
        ...scope,
        shipment: { isNot: null },
        OR: [
          { fulfilmentStatus: { notIn: ['SHIPPED', 'DELIVERED', 'CANCELLED'] as any[] } },
          { fulfilmentStatus: 'SHIPPED', shipment: { is: { status: 'DELIVERED' } } },
        ],
      } as any,
      select: { id: true, ...sel, shipment: { select: { id: true, status: true, airwayBillNumber: true, dispatchedAt: true } } },
    }),
    prisma.taxInvoice.findMany({
      where: { ...scope, fulfilmentStatus: 'DELIVERED', shipment: { is: { status: { in: [...IN_TRANSIT_SHIPMENT] as any[] } } } } as any,
      select: { ...sel, shipment: { select: { status: true, airwayBillNumber: true } } },
    }),
    prisma.taxInvoice.findMany({ where: { ...scope, shipment: { is: null }, fulfilmentStatus: { in: ['SHIPPED', 'DELIVERED'] as any[] } } as any, select: sel }),
    opts.numbers?.length
      ? prisma.taxInvoice.findMany({ where: { invoiceNumber: { in: opts.numbers.slice(0, 50) }, ...(depotId ? { depotId } : {}) }, select: { ...sel, shipment: { select: { status: true, airwayBillNumber: true } } } })
      : Promise.resolve([] as any[]),
  ]);
  const classifications = named.map((i: any) => {
    const state = classifyOrder({ documentStatus: i.documentStatus, fulfilmentStatus: i.fulfilmentStatus, shipmentStatus: i.shipment?.status });
    return {
      invoiceNumber: i.invoiceNumber, customer: i.customerCompany || i.customerName, paymentStatus: i.paymentStatus, fulfilmentStatus: i.fulfilmentStatus,
      shipmentStatus: i.shipment?.status ?? null, airwayBillNumber: i.shipment?.airwayBillNumber ?? null,
      state, stateLabel: ORDER_STATE_LABEL[state],
      countedAs: state === 'PENDING_SHIPMENT' ? 'Pending Shipments' : state === 'IN_TRANSIT' ? 'In transit' : 'not counted (' + ORDER_STATE_LABEL[state].toLowerCase() + ')',
    };
  });
  return {
    counts: { pending: pending.length, inTransit: inTransit.length, statusBehindShipment: behind.length, deliveredButShipmentOpen: deliveredOpen.length, shippedWithoutRecord: noRecord.length },
    pending,
    inTransit: inTransit.map((s) => ({ invoiceNumber: s.invoiceNumber, customer: s.invoice?.customerCompany || s.invoice?.customerName, shipmentStatus: s.status, airwayBillNumber: s.airwayBillNumber, dispatchedAt: s.dispatchedAt, fulfilmentStatus: s.invoice?.fulfilmentStatus, paymentStatus: s.invoice?.paymentStatus })),
    statusBehindShipment: behind.map((i: any) => ({ invoiceNumber: i.invoiceNumber, customer: i.customerCompany || i.customerName, fulfilmentStatus: i.fulfilmentStatus, paymentStatus: i.paymentStatus, shipmentStatus: i.shipment?.status, airwayBillNumber: i.shipment?.airwayBillNumber, dispatchedAt: i.shipment?.dispatchedAt })),
    deliveredButShipmentOpen: deliveredOpen.map((i: any) => ({ invoiceNumber: i.invoiceNumber, customer: i.customerCompany || i.customerName, fulfilmentStatus: i.fulfilmentStatus, shipmentStatus: i.shipment?.status, airwayBillNumber: i.shipment?.airwayBillNumber })),
    shippedWithoutRecord: noRecord,
    classifications,
  };
}

/**
 * Brings an invoice's fulfilment status up to what its shipment record already proves: SHIPPED, or DELIVERED when the
 * shipment is confirmed delivered. An invoice is never made DELIVERED just because it has shipped - only a shipment that
 * itself says DELIVERED does that. Only the status (and the shipment link) changes: no stock movement, no new shipment,
 * no payment or amount change, and each invoice gets its own audit entry. The caller requires { confirm: true }.
 */
export async function syncStatusesFromShipments(actor: Actor, depotId?: string) {
  const scope = depotId ? { depotId } : {};
  const behind = await prisma.taxInvoice.findMany({
    where: {
      ...scope,
      shipment: { isNot: null },
      OR: [
        { fulfilmentStatus: { notIn: ['SHIPPED', 'DELIVERED', 'CANCELLED'] as any[] } },
        { fulfilmentStatus: 'SHIPPED', shipment: { is: { status: 'DELIVERED' } } },
      ],
    } as any,
    select: { id: true, invoiceNumber: true, fulfilmentStatus: true, depotId: true, depotName: true, shipment: { select: { id: true, status: true, shipmentNumber: true, airwayBillNumber: true } } },
  });
  const fixed: { invoiceNumber: string; from: string; to: string }[] = [];
  for (const inv of behind) {
    if (!inv.shipment) continue;
    const to = inv.shipment.status === 'DELIVERED' ? 'DELIVERED' : 'SHIPPED';
    if (to === inv.fulfilmentStatus) continue;
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
