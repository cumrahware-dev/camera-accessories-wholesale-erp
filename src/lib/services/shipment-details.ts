import 'server-only';
import { Prisma } from '@prisma/client';
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

/**
 * What was actually dispatched, read from the Shipment record: courier / carrier, the airway bill, the dispatch date and
 * the uploaded AWB document. The document is always offered as an ERP route (never the storage provider's own URL), so
 * access follows the signed-in user's permissions and the file arrives with its real type and file name.
 */
export async function getDispatch(invoiceId: string) {
  const s = await prisma.shipment.findUnique({
    where: { invoiceId },
    select: {
      id: true, shipmentNumber: true, courier: true, customCourierName: true, carrierName: true, airwayBillNumber: true,
      trackingUrl: true, status: true, dispatchedAt: true, totalWeightKg: true, packageCount: true, awbDocumentId: true, awbDocumentUrl: true,
    },
  });
  if (!s) return null;
  // Historical shipments only kept the provider URL: find the document record by that URL so the file is still served by the ERP.
  const doc = s.awbDocumentId
    ? await prisma.cloudDocument.findUnique({ where: { id: s.awbDocumentId } }).catch(() => null)
    : s.awbDocumentUrl && /^https?:\/\//i.test(s.awbDocumentUrl)
      ? await prisma.cloudDocument.findFirst({ where: { cloudinaryUrl: s.awbDocumentUrl }, orderBy: { uploadedAt: 'desc' } }).catch(() => null)
      : null;
  return {
    shipmentNumber: s.shipmentNumber,
    courierName: s.carrierName || s.customCourierName || s.courier.replace(/_/g, ' '),
    awbNumber: s.airwayBillNumber,
    dispatchedAt: s.dispatchedAt,
    status: s.status,
    trackingUrl: s.trackingUrl || null,
    packageCount: s.packageCount,
    totalWeightKg: s.totalWeightKg,
    document: doc
      ? { id: doc.id, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, uploadedAt: doc.uploadedAt, uploadedByName: doc.uploadedByName, category: doc.category, href: `/api/documents/${doc.id}/file` }
      : null,
    // An old shipment whose file was never recorded as a document: say so instead of offering a link that cannot be opened.
    documentMissing: Boolean((s.awbDocumentId || s.awbDocumentUrl) && !doc),
  };
}

export async function getShipmentDetails(invoiceId: string) {
  const [details, dispatch] = await Promise.all([
    prisma.invoiceShipmentDetails.findUnique({ where: { invoiceId } }),
    getDispatch(invoiceId).catch(() => null),
  ]);
  const history = details
    ? await prisma.invoiceShipmentDetailsHistory.findMany({ where: { invoiceId }, orderBy: { changedAt: 'desc' }, take: 100 })
    : [];
  return { details: details ? { ...details, ...viewOf(details), updatedByName: details.updatedByName, updatedAt: details.updatedAt } : null, dispatch, history };
}

/**
 * Copies what was entered at dispatch into the invoice's AWB / packing details, so the "Shipment & Packing Details"
 * section and the Tax Invoice show the shipment instead of staying empty.
 *
 * Runs inside the dispatch transaction, on the ONE details row per invoice (upsert by invoiceId - never a second AWB
 * record). The airway bill number comes from the dispatch, because that is the number on the actual airway bill; every
 * other field is only filled when it is still empty, so details typed by a person are never overwritten. Each change is
 * recorded in the same history the manual edits use.
 */
export async function syncFromDispatchInTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  d: { awbNumber?: string | null; shipmentDate?: Date | null; packageCount?: number | null; grossWeightKg?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; packingDescription?: string | null },
  actor: Actor
) {
  const existing = await tx.invoiceShipmentDetails.findUnique({ where: { invoiceId } });
  const before = viewOf(existing);
  const patch: Record<string, any> = {};
  const awb = clean(d.awbNumber, 60);
  if (awb && awb !== before.awbNumber) patch.awbNumber = awb;
  const fill = (k: 'shipmentDate' | 'packageCount' | 'grossWeightKg' | 'lengthCm' | 'widthCm' | 'heightCm' | 'packingDescription', v: any) => {
    const empty = before[k] === null || before[k] === '' || before[k] === undefined;
    if (!empty || v === null || v === undefined || v === '') return;
    if (typeof v === 'number' && !(Number.isFinite(v) && v >= 0)) return;
    patch[k] = v;
  };
  fill('shipmentDate', d.shipmentDate ?? null);
  fill('packageCount', d.packageCount ?? null);
  // The dispatch weight is only taken when it does not contradict a net weight someone already recorded
  // (the manual form refuses net > gross, and the two must stay consistent).
  if (before.netWeightKg === null || Number(d.grossWeightKg ?? 0) >= Number(before.netWeightKg)) fill('grossWeightKg', d.grossWeightKg ?? null);
  fill('lengthCm', d.lengthCm ?? null);
  fill('widthCm', d.widthCm ?? null);
  fill('heightCm', d.heightCm ?? null);
  fill('packingDescription', d.packingDescription ? cleanMulti(d.packingDescription, 500) : null);

  const merged = { ...before, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])) } as ReturnType<typeof viewOf>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of FIELDS) if (JSON.stringify(before[k]) !== JSON.stringify(merged[k])) changes[k] = { from: before[k], to: merged[k] };
  if (!Object.keys(changes).length) {
    if (existing) await tx.invoiceShipmentDetails.update({ where: { invoiceId }, data: { dispatchSyncedAt: new Date() } });
    return { changed: false, changes };
  }
  const data = { ...patch, dispatchSyncedAt: new Date(), updatedById: actor.id, updatedByName: actor.name };
  const row = existing
    ? await tx.invoiceShipmentDetails.update({ where: { invoiceId }, data })
    : await tx.invoiceShipmentDetails.create({ data: { invoiceId, ...data } as any });
  await tx.invoiceShipmentDetailsHistory.create({
    data: { detailsId: row.id, invoiceId, action: existing ? 'UPDATED' : 'CREATED', changes: changes as any, changedById: actor.id, changedByName: `${actor.name} (dispatch)`, changedByRole: actor.role },
  });
  return { changed: true, changes };
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

/**
 * Replaces the airway bill document attached to a dispatched shipment with an already-uploaded one.
 * The document must exist; only the shipment's reference changes, so the previous file is left in the Documents
 * module unless the caller also removes it.
 */
export async function attachAwbDocument(invoiceId: string, documentId: string, actor: Actor) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, documentStatus: true, fulfilmentStatus: true, depotId: true, depotName: true } });
  if (!inv) throw new ShipmentDetailsError(404, 'Invoice not found.');
  if (inv.documentStatus === 'CANCELLED' || inv.fulfilmentStatus === 'CANCELLED') throw new ShipmentDetailsError(409, 'A cancelled invoice cannot take an airway bill document.');
  const shipment = await prisma.shipment.findUnique({ where: { invoiceId }, select: { id: true, shipmentNumber: true, awbDocumentId: true } });
  if (!shipment) throw new ShipmentDetailsError(409, 'This invoice has not been dispatched yet, so there is no shipment to attach the airway bill to.');
  const doc = await prisma.cloudDocument.findUnique({ where: { id: documentId }, select: { id: true, fileName: true, cloudinaryUrl: true } });
  if (!doc) throw new ShipmentDetailsError(404, 'That document could not be found. Upload the airway bill again.');

  await prisma.shipment.update({ where: { invoiceId }, data: { awbDocumentId: doc.id, awbDocumentUrl: doc.cloudinaryUrl } });
  await writeAudit(actor, {
    action: 'INVOICE_AWB_DOCUMENT_ATTACHED', entityType: 'INVOICE', entityId: inv.id, entityLabel: inv.invoiceNumber,
    description: `Airway bill document "${doc.fileName}" attached to ${inv.invoiceNumber} (shipment ${shipment.shipmentNumber})`,
    previousValue: { awbDocumentId: shipment.awbDocumentId }, newValue: { awbDocumentId: doc.id, fileName: doc.fileName },
    depotId: inv.depotId, depotName: inv.depotName,
  });
  return getShipmentDetails(invoiceId);
}

/**
 * Removes the airway bill document from a dispatched shipment.
 *
 * The shipment's reference is always cleared, so the section stops offering a file that should no longer be there.
 * The stored document itself is only deleted when `deleteFile` is set - which the route only allows for a user who may
 * delete documents - so someone who may correct shipment details cannot destroy a file as a side effect. The airway
 * bill NUMBER and the rest of the details are untouched: only the attachment goes. Always audited.
 */
export async function removeAwbDocument(invoiceId: string, actor: Actor, { deleteFile }: { deleteFile: boolean }) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, depotId: true, depotName: true } });
  if (!inv) throw new ShipmentDetailsError(404, 'Invoice not found.');
  const shipment = await prisma.shipment.findUnique({ where: { invoiceId }, select: { id: true, shipmentNumber: true, awbDocumentId: true, awbDocumentUrl: true } });
  if (!shipment) throw new ShipmentDetailsError(409, 'This invoice has not been dispatched yet, so there is no airway bill document on it.');
  if (!shipment.awbDocumentId && !shipment.awbDocumentUrl) throw new ShipmentDetailsError(409, 'There is no airway bill document on this shipment.');

  const doc = shipment.awbDocumentId
    ? await prisma.cloudDocument.findUnique({ where: { id: shipment.awbDocumentId }, select: { id: true, fileName: true, cloudinaryPublicId: true } }).catch(() => null)
    : null;

  await prisma.shipment.update({ where: { invoiceId }, data: { awbDocumentId: null, awbDocumentUrl: null } });

  let fileDeleted = false;
  if (deleteFile && doc) {
    try {
      await prisma.cloudDocument.delete({ where: { id: doc.id } });
      fileDeleted = true;
      // Best-effort: the record is gone either way, so a storage hiccup must not fail the removal.
      const { deleteAsset } = await import('@/lib/cloudinary');
      await deleteAsset({ id: doc.cloudinaryPublicId }).catch((e: any) => console.warn('[AWB] storage cleanup failed:', e?.message));
    } catch (e: any) {
      console.warn('[AWB] document record could not be deleted:', e?.message);
    }
  }

  await writeAudit(actor, {
    action: 'INVOICE_AWB_DOCUMENT_REMOVED', entityType: 'INVOICE', entityId: inv.id, entityLabel: inv.invoiceNumber,
    description: `Airway bill document${doc ? ` "${doc.fileName}"` : ''} removed from ${inv.invoiceNumber} (shipment ${shipment.shipmentNumber})${fileDeleted ? ' and deleted from document storage' : '; the file is kept in Documents'}`,
    previousValue: { awbDocumentId: shipment.awbDocumentId, fileName: doc?.fileName ?? null }, newValue: { awbDocumentId: null, fileDeleted },
    depotId: inv.depotId, depotName: inv.depotName,
  });
  return { ...(await getShipmentDetails(invoiceId)), fileDeleted };
}
