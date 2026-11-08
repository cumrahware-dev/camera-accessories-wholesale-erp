import 'server-only';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { destroyAsset } from '@/lib/cloudinary';
import { categoryLabel } from '@/lib/documents/categories';

interface Actor { id: string; name: string; role: string }

export class DocumentDeleteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const DOC_DELETED_ACTION = 'DOCUMENT_DELETED';
export type StorageOutcome = 'deleted' | 'already_missing' | 'kept_shared' | 'kept_linked' | 'pending';

/**
 * Removes the stored file for a public id, unless something still uses it. Never deletes by a user-supplied name or URL:
 * only the public id of a record this ERP held. Returns what happened; throws only for a real storage failure.
 */
async function removeStoredFile(publicId: string): Promise<StorageOutcome> {
  const stillUsed = await prisma.cloudDocument.count({ where: { cloudinaryPublicId: publicId } });
  if (stillUsed > 0) return 'kept_shared';
  const res = await destroyAsset({ id: publicId });
  return res === 'ok' ? 'deleted' : 'already_missing';
}

async function settleAudit(auditId: string, outcome: StorageOutcome, error?: string) {
  const row = await prisma.auditLog.findUnique({ where: { id: auditId }, select: { metadata: true, description: true } }).catch(() => null);
  if (!row) return;
  const meta: any = (row.metadata as any) || {};
  meta.storage = { ...(meta.storage || {}), status: outcome, settledAt: new Date().toISOString(), ...(error ? { lastError: error.slice(0, 200) } : { lastError: null }) };
  await prisma.auditLog.update({ where: { id: auditId }, data: { metadata: meta } }).catch(() => {});
}

/**
 * Deletes one document attached to an invoice (and its shipment).
 *
 * Ownership is checked on the server: the document must belong to this invoice (its related entity is the invoice) or be
 * the airway bill attached to this invoice's shipment. A document that only belongs elsewhere is merely un-linked.
 *
 * Order: database first (in ONE transaction that also writes a durable audit row marked storage=pending), storage second.
 * If storage fails the record is already gone from every list, the audit row stays pending and `reconcilePendingDeletes`
 * (also run lazily) retries it - so database and storage cannot silently diverge. Stock, payment, shipment status and
 * amounts are never touched.
 */
export async function deleteInvoiceDocument(actor: Actor, invoiceId: string, documentId: string, ip?: string) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, depotId: true, depotName: true } });
  if (!inv) throw new DocumentDeleteError(404, 'Invoice not found.');
  const doc = await prisma.cloudDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new DocumentDeleteError(404, 'This document no longer exists. It may already have been deleted.');
  const shipment = await prisma.shipment.findUnique({ where: { invoiceId }, select: { id: true, shipmentNumber: true, awbDocumentId: true } });
  const owned = doc.relatedEntityId === inv.id && (doc.relatedEntityType === 'INVOICE' || doc.relatedEntityType === 'SHIPMENT');
  const linked = !!shipment && shipment.awbDocumentId === doc.id;
  if (!owned && !linked) throw new DocumentDeleteError(404, 'This document does not belong to this invoice or its shipment.');

  const result = await prisma.$transaction(async (tx) => {
    const fresh = await tx.cloudDocument.findUnique({ where: { id: doc.id }, select: { id: true } });
    if (!fresh) throw new DocumentDeleteError(404, 'This document was already deleted.');
    const refs = await tx.shipment.findMany({ where: { OR: [{ awbDocumentId: doc.id }, ...(owned && doc.cloudinaryUrl ? [{ awbDocumentUrl: doc.cloudinaryUrl }] : [])] }, select: { id: true, invoiceId: true } });
    // an owned document is detached everywhere; a linked-only one is detached from this invoice's shipment only
    const detach = owned ? refs : refs.filter((r) => r.invoiceId === inv.id);
    if (detach.length) await tx.shipment.updateMany({ where: { id: { in: detach.map((r) => r.id) } }, data: { awbDocumentId: null, awbDocumentUrl: null } });
    if (owned) {
      const gone = await tx.cloudDocument.deleteMany({ where: { id: doc.id } });
      if (gone.count !== 1) throw new DocumentDeleteError(404, 'This document was already deleted.');
    }
    const audit = await tx.auditLog.create({
      data: {
        userId: (await tx.user.findUnique({ where: { id: actor.id }, select: { id: true } }))?.id ?? null,
        userName: actor.name, userRole: actor.role as any,
        action: DOC_DELETED_ACTION, entityType: 'INVOICE', entityId: inv.id, entityLabel: inv.invoiceNumber,
        description: `${categoryLabel(doc.category)} "${doc.fileName}" ${owned ? 'deleted' : 'removed'} from ${inv.invoiceNumber}${shipment ? ` (shipment ${shipment.shipmentNumber})` : ''}. No stock, payment, shipment status or amount changed.`,
        previousValue: JSON.stringify({ documentId: doc.id, fileName: doc.fileName, category: doc.category }),
        newValue: JSON.stringify({ deleted: owned }),
        depotId: inv.depotId, depotName: inv.depotName, ipAddress: ip || undefined,
        metadata: {
          document: { id: doc.id, title: doc.title, fileName: doc.fileName, fileType: doc.fileType, category: doc.category, uploadedBy: doc.uploadedByName, uploadedAt: doc.uploadedAt },
          parent: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, shipmentId: shipment?.id ?? null, shipmentNumber: shipment?.shipmentNumber ?? null },
          deletedBy: { id: actor.id, name: actor.name }, mode: owned ? 'deleted' : 'unlinked',
          storage: { status: owned ? 'pending' : 'kept_linked', publicId: owned ? doc.cloudinaryPublicId : null },
        } as any,
      },
      select: { id: true },
    });
    return { auditId: audit.id };
  });

  let storage: StorageOutcome = 'kept_linked';
  if (owned) {
    try {
      storage = await removeStoredFile(doc.cloudinaryPublicId);
      await settleAudit(result.auditId, storage);
    } catch (e: any) {
      storage = 'pending';
      await settleAudit(result.auditId, 'pending', e?.message || 'storage error');
      console.warn('[Documents] stored file not removed yet; it will be retried:', e?.message);
    }
  } else {
    await settleAudit(result.auditId, 'kept_linked');
  }
  return { deleted: owned, unlinked: !owned, storage, documentId: doc.id, fileName: doc.fileName };
}

/** Retries every deletion whose stored file could not be removed at the time. Idempotent; safe to call repeatedly. */
export async function reconcilePendingDeletes(limit = 25) {
  const rows = await prisma.auditLog.findMany({
    where: { action: DOC_DELETED_ACTION, metadata: { path: ['storage', 'status'], equals: 'pending' } } as any,
    select: { id: true, metadata: true }, take: limit, orderBy: { timestamp: 'asc' },
  }).catch(() => [] as { id: string; metadata: any }[]);
  let settled = 0, failed = 0;
  for (const r of rows) {
    const publicId = (r.metadata as any)?.storage?.publicId;
    if (!publicId) continue;
    try {
      const out = await removeStoredFile(publicId);
      await settleAudit(r.id, out);
      settled++;
    } catch (e: any) {
      await settleAudit(r.id, 'pending', e?.message || 'storage error');
      failed++;
    }
  }
  return { checked: rows.length, settled, failed };
}
