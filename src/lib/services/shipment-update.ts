import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export const SHIPMENT_STATUSES = ['READY', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const COURIER_VALUES = ['DHL_EXPRESS', 'FEDEX_INTERNATIONAL', 'ARAMEX', 'EMIRATES_SKYCARGO', 'UPS', 'OTHER'] as const;

export class ShipmentUpdateError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
interface Actor { id: string; name: string; role: string }

export async function findShipmentByRef(ref: string) {
  return prisma.shipment.findFirst({ where: { OR: [{ id: ref }, { shipmentNumber: ref }, { invoiceId: ref }] } });
}

/**
 * The ONE place a shipment's status is changed, used by both shipment routes (the Shipments page and the detail API).
 *
 * The shipment and its invoice move together, in one transaction, so they cannot disagree afterwards:
 *   - DELIVERED  -> the invoice becomes DELIVERED (only here, never as a side effect of merely being shipped)
 *   - moved back off DELIVERED -> an invoice that had been marked DELIVERED returns to SHIPPED
 * A cancelled invoice is left alone. Stock and payment are never touched. The change is audited.
 */
export async function updateShipment(
  actor: Actor,
  existing: { id: string; shipmentNumber: string; invoiceId: string | null; status: string; depotId: string; depotName: string },
  patch: { status?: unknown; courier?: unknown; trackingUrl?: unknown; airwayBillNumber?: unknown },
  ip?: string
) {
  const { status, courier, trackingUrl, airwayBillNumber } = patch;
  if (status !== undefined && !(SHIPMENT_STATUSES as readonly string[]).includes(String(status))) throw new ShipmentUpdateError(400, 'Unknown shipment status.');
  if (courier !== undefined && !(COURIER_VALUES as readonly string[]).includes(String(courier))) throw new ShipmentUpdateError(400, 'Unknown courier.');
  const next = status as string | undefined;

  const result = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    if (next) data.status = next;
    if (next === 'DELIVERED' && existing.status !== 'DELIVERED') data.deliveredAt = new Date();
    if (next && next !== 'DELIVERED' && existing.status === 'DELIVERED') data.deliveredAt = null;
    if (courier) data.courier = courier;
    if (typeof trackingUrl === 'string' && trackingUrl) data.trackingUrl = trackingUrl.slice(0, 500);
    if (typeof airwayBillNumber === 'string' && airwayBillNumber) data.airwayBillNumber = airwayBillNumber.slice(0, 80);
    const s = await tx.shipment.update({ where: { id: existing.id }, data: data as any });
    let invoiceChange: { from: string; to: string } | null = null;
    if (next && existing.invoiceId) {
      const inv = await tx.taxInvoice.findUnique({ where: { id: existing.invoiceId }, select: { fulfilmentStatus: true } });
      if (inv && inv.fulfilmentStatus !== 'CANCELLED') {
        const to = next === 'DELIVERED' ? 'DELIVERED' : inv.fulfilmentStatus === 'DELIVERED' ? 'SHIPPED' : null;
        if (to && to !== inv.fulfilmentStatus) {
          // conditional on the status just read, so a concurrent change is never overwritten
          const r = await tx.taxInvoice.updateMany({ where: { id: existing.invoiceId, fulfilmentStatus: inv.fulfilmentStatus }, data: { fulfilmentStatus: to as any } });
          if (r.count === 1) invoiceChange = { from: inv.fulfilmentStatus, to };
        }
      }
    }
    return { s, invoiceChange };
  });

  await writeAudit(actor, {
    action: 'SHIPMENT_UPDATED', entityType: 'Shipment', entityId: existing.id, entityLabel: existing.shipmentNumber,
    description: `Shipment ${existing.shipmentNumber} updated${next ? ` (status ${existing.status} -> ${next})` : ''}${result.invoiceChange ? `; invoice status ${result.invoiceChange.from} -> ${result.invoiceChange.to}` : ''}`,
    ip, depotId: existing.depotId, depotName: existing.depotName, previousValue: existing.status, newValue: next,
  });
  return result.s;
}
