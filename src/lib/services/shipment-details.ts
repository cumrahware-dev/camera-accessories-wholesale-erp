import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

export class ShipmentDetailsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
interface Actor { id: string; name: string; role: string }

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanMulti = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

/** null/'' = cleared; undefined = not supplied (left as it is). */
function num(v: unknown, label: string, opts: { max: number; decimals: number; integer?: boolean }): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
  const text = typeof v === 'string' ? v.trim().replace(/,/g, '') : String(v);
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) throw new ShipmentDetailsError(400, `${label} must be a number of zero or more.`);
  if (n > opts.max) throw new ShipmentDetailsError(400, `${label} is too large.`);
  if (opts.integer && !Number.isInteger(n)) throw new ShipmentDetailsError(400, `${label} must be a whole number.`);
  const frac = /\.(\d+)$/.exec(text)?.[1]?.replace(/0+$/, '') ?? '';
  if (frac.length > opts.decimals) throw new ShipmentDetailsError(400, `${label} can have at most ${opts.decimals} decimal place${opts.decimals === 1 ? '' : 's'}.`);
  return n;
}
function day(v: unknown, label: string): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
  const t = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) throw new ShipmentDetailsError(400, `${label} is not a valid date (use YYYY-MM-DD).`);
  const d = new Date(`${t.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new ShipmentDetailsError(400, `${label} is not a valid date.`);
  if (d.getTime() > Date.now() + 2 * 86400000) throw new ShipmentDetailsError(400, `${label} cannot be in the future.`);
  return d;
}
const iso = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : null);

const FIELDS = ['awbNumber', 'awbReceivedDate', 'shipmentDate', 'packageCount', 'packingDescription', 'grossWeightKg', 'netWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'remarks', 'buyerResponsibleInsurance'] as const;
type Field = typeof FIELDS[number];

/** Normalised view used for diffing and for the documents. */
export function viewOf(d: any): Record<Field, string | number | boolean | null> {
  return {
    awbNumber: d?.awbNumber ?? '', awbReceivedDate: iso(d?.awbReceivedDate), shipmentDate: iso(d?.shipmentDate),
    packageCount: d?.packageCount ?? null, packingDescription: d?.packingDescription ?? '',
    grossWeightKg: d?.grossWeightKg == null ? null : Number(d.grossWeightKg), netWeightKg: d?.netWeightKg == null ? null : Number(d.netWeightKg),
    lengthCm: d?.lengthCm == null ? null : Number(d.lengthCm), widthCm: d?.widthCm == null ? null : Number(d.widthCm), heightCm: d?.heightCm == null ? null : Number(d.heightCm),
    remarks: d?.remarks ?? '', buyerResponsibleInsurance: !!d?.buyerResponsibleInsurance,
  };
}

export async function getShipmentDetails(invoiceId: string) {
  const details = await prisma.invoiceShipmentDetails.findUnique({ where: { invoiceId } });
  const history = details
    ? await prisma.invoiceShipmentDetailsHistory.findMany({ where: { invoiceId }, orderBy: { changedAt: 'desc' }, take: 100 })
    : [];
  return { details: details ? { ...details, ...viewOf(details), updatedByName: details.updatedByName, updatedAt: details.updatedAt } : null, history };
}

/**
 * Adds or updates the supplementary AWB / packing details of an ISSUED invoice. Only these fields are written: the invoice
 * row (lines, VAT, totals, number, customer) is never touched. Every change is recorded with who, when and the old/new values.
 */
export async function saveShipmentDetails(invoiceId: string, body: any, actor: Actor) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, documentStatus: true, fulfilmentStatus: true, depotId: true, depotName: true } });
  if (!inv) throw new ShipmentDetailsError(404, 'Invoice not found.');
  if (inv.documentStatus === 'DRAFT') throw new ShipmentDetailsError(409, 'This invoice is still a draft. Issue it first; shipment details are recorded on issued invoices.');
  if (inv.documentStatus === 'CANCELLED' || inv.fulfilmentStatus === 'CANCELLED') throw new ShipmentDetailsError(409, 'A cancelled invoice cannot take shipment details.');

  const patch: Partial<Record<Field, any>> = {};
  const put = (k: Field, v: any) => { if (v !== undefined) patch[k] = v; };
  if (body.awbNumber !== undefined) {
    const a = clean(body.awbNumber, 60);
    if (a && !/^[A-Za-z0-9][A-Za-z0-9 \-\/._]*$/.test(a)) throw new ShipmentDetailsError(400, 'The AWB number may only contain letters, digits, spaces and - / . _');
    put('awbNumber', a);
  }
  put('awbReceivedDate', day(body.awbReceivedDate, 'AWB received date'));
  put('shipmentDate', day(body.shipmentDate, 'Shipment date'));
  put('packageCount', num(body.packageCount, 'Number of packages', { max: 1_000_000, decimals: 0, integer: true }));
  if (body.packingDescription !== undefined) put('packingDescription', cleanMulti(body.packingDescription, 500));
  put('grossWeightKg', num(body.grossWeightKg, 'Gross weight', { max: 9_999_999, decimals: 3 }));
  put('netWeightKg', num(body.netWeightKg, 'Net weight', { max: 9_999_999, decimals: 3 }));
  put('lengthCm', num(body.lengthCm, 'Length', { max: 100_000, decimals: 2 }));
  put('widthCm', num(body.widthCm, 'Width', { max: 100_000, decimals: 2 }));
  put('heightCm', num(body.heightCm, 'Height', { max: 100_000, decimals: 2 }));
  if (body.remarks !== undefined) put('remarks', cleanMulti(body.remarks, 1000));
  if (body.buyerResponsibleInsurance !== undefined) put('buyerResponsibleInsurance', body.buyerResponsibleInsurance === true || body.buyerResponsibleInsurance === 'true');

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.invoiceShipmentDetails.findUnique({ where: { invoiceId } });
    const before = viewOf(existing);
    const merged = { ...before, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])) } as ReturnType<typeof viewOf>;
    const g = merged.grossWeightKg, n = merged.netWeightKg;
    if (g != null && n != null && Number(n) > Number(g)) throw new ShipmentDetailsError(400, 'The net weight cannot be more than the gross weight.');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of FIELDS) if (JSON.stringify(before[k]) !== JSON.stringify(merged[k])) changes[k] = { from: before[k], to: merged[k] };
    if (!Object.keys(changes).length) return { row: existing, changed: false, created: false };
    const data = { ...patch, updatedById: actor.id, updatedByName: actor.name };
    const row = existing
      ? await tx.invoiceShipmentDetails.update({ where: { invoiceId }, data })
      : await tx.invoiceShipmentDetails.create({ data: { invoiceId, ...data } as any });
    await tx.invoiceShipmentDetailsHistory.create({ data: { detailsId: row.id, invoiceId, action: existing ? 'UPDATED' : 'CREATED', changes: changes as any, changedById: actor.id, changedByName: actor.name, changedByRole: actor.role } });
    return { row, changed: true, created: !existing, changes };
  });

  if (saved.changed) {
    await writeAudit(actor, {
      action: saved.created ? 'INVOICE_SHIPMENT_DETAILS_ADDED' : 'INVOICE_SHIPMENT_DETAILS_UPDATED', entityType: 'INVOICE', entityId: inv.id, entityLabel: inv.invoiceNumber,
      description: `${saved.created ? 'Added' : 'Updated'} AWB / packing details on ${inv.invoiceNumber}: ${Object.keys((saved as any).changes).join(', ')}`,
      newValue: (saved as any).changes, depotId: inv.depotId, depotName: inv.depotName,
    });
  }
  return { ...(await getShipmentDetails(invoiceId)), unchanged: !saved.changed };
}
