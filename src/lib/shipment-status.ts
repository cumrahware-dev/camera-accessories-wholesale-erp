/**
 * What "pending shipment" means, in one place.
 *
 * An order is PENDING SHIPMENT when it is a live tax invoice (issued, not a draft, not cancelled) whose goods have not
 * left the depot yet: no shipment record exists and its fulfilment status is not SHIPPED or DELIVERED. A Shipment
 * record is only created at dispatch, so counting shipment records can never measure what is waiting to be shipped -
 * it measures what HAS been shipped.
 *
 * Shipped but not yet confirmed delivered is a different state (IN TRANSIT), reported separately and never treated as
 * delivered. Payment is a third, independent dimension: a paid order can still be pending shipment and a shipped order
 * can still be unpaid, so payment status plays no part in any of this.
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

/**
 * Prisma filter for shipments that have left the depot but whose delivery is not confirmed yet. The shipment of a
 * cancelled invoice is not active work, so it is left out, like cancelled orders are everywhere else.
 */
export function inTransitShipmentWhere(depotId?: string) {
  return {
    ...(depotId ? { depotId } : {}),
    status: { in: [...IN_TRANSIT_SHIPMENT] as any[] },
    invoice: { is: { documentStatus: { not: 'CANCELLED' as any }, fulfilmentStatus: { not: 'CANCELLED' as any } } },
  };
}

export type OrderState = 'DRAFT' | 'CANCELLED' | 'PENDING_SHIPMENT' | 'IN_TRANSIT' | 'DELIVERED';

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  DRAFT: 'Draft',
  CANCELLED: 'Cancelled',
  PENDING_SHIPMENT: 'Pending shipment',
  IN_TRANSIT: 'Shipped, in transit',
  DELIVERED: 'Delivered',
};

/**
 * Where one order stands. The shipment record, when there is one, is the evidence that the goods left (and, when it says
 * DELIVERED, that they arrived); without a record the invoice's own fulfilment status decides. Payment is not an input.
 * This is the rule the dashboard's SQL filters implement, so a single invoice can be checked against the dashboard.
 */
export function classifyOrder(o: { documentStatus?: string | null; fulfilmentStatus?: string | null; shipmentStatus?: string | null }): OrderState {
  if (o.documentStatus === 'DRAFT') return 'DRAFT';
  if (o.documentStatus === 'CANCELLED' || o.fulfilmentStatus === 'CANCELLED') return 'CANCELLED';
  if (o.shipmentStatus) return o.shipmentStatus === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT';
  if (o.fulfilmentStatus === 'DELIVERED') return 'DELIVERED';
  if (o.fulfilmentStatus === 'SHIPPED') return 'IN_TRANSIT';
  if (o.fulfilmentStatus === 'DRAFT') return 'DRAFT';
  return 'PENDING_SHIPMENT';
}

/** Same rule for an invoice object already in memory (lists, the offline data store). */
export function isPendingShipment(inv: { documentStatus?: string | null; fulfilmentStatus?: string | null; shipmentId?: string | null; shipment?: unknown }) {
  if (!inv) return false;
  return classifyOrder({ documentStatus: inv.documentStatus, fulfilmentStatus: inv.fulfilmentStatus, shipmentStatus: inv.shipmentId || inv.shipment ? 'DISPATCHED' : null }) === 'PENDING_SHIPMENT';
}
