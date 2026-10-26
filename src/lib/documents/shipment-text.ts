/**
 * What the Tax Invoice prints for the supplementary AWB / packing details and the insurance wording. One function feeds the
 * server PDF, the on-screen preview and the print output, so they always say the same thing. Browser-safe.
 */
import { formatQty } from '@/lib/quantity';
import { printableDelivery } from '@/lib/documents/terms';

export const BUYER_INSURANCE = 'Buyer Responsible for Insurance';

export interface ShipmentDetailsLike {
  awbNumber?: string | null; awbReceivedDate?: unknown; shipmentDate?: unknown; packageCount?: number | null; packingDescription?: string | null;
  grossWeightKg?: unknown; netWeightKg?: unknown; lengthCm?: unknown; widthCm?: unknown; heightCm?: unknown; remarks?: string | null; buyerResponsibleInsurance?: boolean | null;
}
const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const dim = (v: unknown) => formatQty(Number(v), Math.min(2, (String(Number(v)).split('.')[1] || '').length));

/** [label, value] rows for the "Shipment & Packing Details" block; empty when nothing has been entered. */
export function shipmentRows(d: ShipmentDetailsLike | null | undefined, fmtDate: (v: unknown) => string): [string, string][] {
  if (!d) return [];
  const rows: [string, string][] = [];
  if (String(d.awbNumber || '').trim()) rows.push(['AWB No.', String(d.awbNumber).trim()]);
  if (d.awbReceivedDate) rows.push(['AWB received', fmtDate(d.awbReceivedDate)]);
  if (d.shipmentDate) rows.push(['Shipment date', fmtDate(d.shipmentDate)]);
  if (has(d.packageCount)) rows.push(['No. of packages', String(d.packageCount)]);
  if (String(d.packingDescription || '').trim()) rows.push(['Packing details', String(d.packingDescription).trim()]);
  if (has(d.grossWeightKg)) rows.push(['Gross weight', `${formatQty(Number(d.grossWeightKg), (String(Number(d.grossWeightKg)).split('.')[1] || '').length)} kg`]);
  if (has(d.netWeightKg)) rows.push(['Net weight', `${formatQty(Number(d.netWeightKg), (String(Number(d.netWeightKg)).split('.')[1] || '').length)} kg`]);
  const dims = [d.lengthCm, d.widthCm, d.heightCm];
  if (dims.some(has)) rows.push(['Dimensions (L × W × H)', `${dims.map((x) => (has(x) ? dim(x) : '—')).join(' × ')} cm`]);
  if (String(d.remarks || '').trim()) rows.push(['Shipping remarks', String(d.remarks).trim()]);
  return rows;
}

/** One statement per line: the document's delivery note (split on ; or new lines) plus the insurance wording once, if it is set. */
export function termLines(deliveryTerms: unknown, d?: ShipmentDetailsLike | null): string[] {
  const lines = printableDelivery(deliveryTerms).split(/\s*(?:;|\n)\s*/).map((t) => t.trim()).filter(Boolean);
  if (d?.buyerResponsibleInsurance && !lines.some((l) => l.toLowerCase() === BUYER_INSURANCE.toLowerCase())) lines.push(BUYER_INSURANCE);
  return lines;
}
