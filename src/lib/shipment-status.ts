/**
 * What "pending shipment" means, in one place.
 *
 * An order is PENDING SHIPMENT when it is a live tax invoice (issued, not a draft, not cancelled) whose goods have not
 * left the depot yet: no shipment record exists and its fulfilment status is not SHIPPED or DELIVERED. A Shipment
 * record is only created at dispatch, so counting shipment records can never measure what is waiting to be shipped -
 * it measures what HAS been shipped.
 *
 * Shipped but not yet confirmed delivered is a different state (IN TRANSIT), reported separately. Payment is a third,
 * independent dimension: a paid order can still be pending shipment and a shipped order can still be unpaid, so payment
 * status plays no part here.
 */
export const SHIPPED_FULFILMENT = ['SHIPPED', 'DELIVERED'] as const;
export const IN_TRANSIT_SHIPMENT = ['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] as const;

/** Prisma filter for tax invoices pending shipment (optionally for one depot). */
export function pendingShipmentWhere(depotId?: string) {
  return {
    ...(depotId ? { depotId } : {}),
    documentStatus: { notIn: ['DRAFT', 'CANCELLED'] as any[] },
    fulfilmentStatus: { notIn: ['DRAFT', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as any[] },
    shipment: { is: null },
  };
}

/** Prisma filter for shipments that have left the depot but whose delivery is not confirmed yet. */
export function inTransitShipmentWhere(depotId?: string) {
  return { ...(depotId ? { depotId } : {}), status: { in: [...IN_TRANSIT_SHIPMENT] as any[] } };
}

/** Same rule for an invoice object already in memory (lists, the offline data store). */
export function isPendingShipment(inv: { documentStatus?: string | null; fulfilmentStatus?: string | null; shipmentId?: string | null; shipment?: unknown }) {
  if (!inv) return false;
  if (inv.documentStatus === 'DRAFT' || inv.documentStatus === 'CANCELLED') return false;
  if (['DRAFT', 'SHIPPED', 'DELIVERED', 'CANCELLED'].includes(String(inv.fulfilmentStatus))) return false;
  return !inv.shipmentId && !inv.shipment;
}
