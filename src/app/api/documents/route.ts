import { DOCUMENT_CATEGORY_VALUES } from '@/lib/documents/categories';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'documents.read');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(req.url);
    const entityId = searchParams.get('entityId') || undefined;
    const category = searchParams.get('category') || undefined;
    const q = searchParams.get('q')?.trim();
    const { take, skip } = parsePagination(req);

    const scopedDepotId = depotIdFilter(auth.user);
    try {
      const where: any = {};
      if (entityId) where.relatedEntityId = entityId;
      if (category && category !== 'ALL') where.category = category;
      if (scopedDepotId) where.depotId = scopedDepotId;
      if (q) {
        where.OR = [
          { title: { contains: q, mode: 'insensitive' as const } },
          { fileName: { contains: q, mode: 'insensitive' as const } },
          { relatedEntityLabel: { contains: q, mode: 'insensitive' as const } },
        ];
      }

      const documents = await prisma.cloudDocument.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { uploadedAt: 'desc' },
        take,
        skip,
      });
      return NextResponse.json(documents);
    } catch {
      let docs = dataStore.getDocuments({ category, entityId });
      if (q) {
        const query = q.toLowerCase();
        docs = docs.filter(
          (d) =>
            d.title.toLowerCase().includes(query) ||
            d.fileName.toLowerCase().includes(query) ||
            (d.relatedEntityLabel && d.relatedEntityLabel.toLowerCase().includes(query)) ||
            (d.tags && d.tags.some((t) => t.toLowerCase().includes(query)))
        );
      }
      return NextResponse.json(docs);
    }
  } catch (error) {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const depotId = depotIdFilter(auth.user);
    const CATEGORIES = DOCUMENT_CATEGORY_VALUES;
    if (!body?.title || !body?.fileName || !body?.cloudinaryUrl || !body?.cloudinaryPublicId) {
      return NextResponse.json({ error: 'title, fileName, cloudinaryUrl and cloudinaryPublicId are required' }, { status: 400 });
    }
    if (body.category && !CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: 'Invalid document category' }, { status: 400 });
    }
    // Whitelist fields: never accept ids, timestamps or uploader identity from the client.
    const document = await prisma.cloudDocument.create({
      data: {
        title: String(body.title).slice(0, 200),
        fileName: String(body.fileName).slice(0, 200),
        fileType: String(body.fileType || 'application/pdf'),
        fileFormat: String(body.fileFormat || String(body.fileName).split('.').pop() || 'pdf'),
        fileSize: Number(body.fileSize) || 0,
        cloudinaryUrl: String(body.cloudinaryUrl),
        cloudinaryPublicId: String(body.cloudinaryPublicId),
        category: body.category || 'OTHER',
        relatedEntityType: body.relatedEntityType ?? null,
        relatedEntityId: body.relatedEntityId ?? null,
        relatedEntityLabel: body.relatedEntityLabel ?? null,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        uploadedBy: auth.user.id,
        uploadedByName: auth.user.name,
        depotId: depotId || body.depotId || null,
      },
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error: any) {
    console.error('Error creating document:', error);
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await guardApi(req, 'documents.delete');
  if (!auth.ok) return auth.response;

  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Document ID required' }, { status: 400 });

    const document = await prisma.cloudDocument.findUnique({ where: { id } });
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const scopedDepotId = depotIdFilter(auth.user);
    if (scopedDepotId && document.depotId !== scopedDepotId) {
      return NextResponse.json({ error: 'Forbidden: document is outside your assigned depot' }, { status: 403 });
    }
    // A shipment that points at this document must not be left offering a file that no longer exists.
    const shipments = await prisma.shipment.findMany({
      where: { OR: [{ awbDocumentId: id }, ...(document.cloudinaryUrl ? [{ awbDocumentUrl: document.cloudinaryUrl }] : [])] },
      select: { id: true, invoiceNumber: true },
    }).catch(() => [] as { id: string; invoiceNumber: string }[]);
    await prisma.cloudDocument.delete({ where: { id } });
    if (shipments.length) {
      await prisma.shipment.updateMany({ where: { id: { in: shipments.map((x) => x.id) } }, data: { awbDocumentId: null, awbDocumentUrl: null } }).catch(() => {});
      console.log(`[Documents] ${id} deleted; detached from shipment(s) ${shipments.map((x) => x.invoiceNumber).join(', ')}`);
    }

    // Remove the stored file only when no other record still uses it; a failure is logged and audited for a retry.
    let storage = 'deleted';
    try {
      const stillUsed = await prisma.cloudDocument.count({ where: { cloudinaryPublicId: document.cloudinaryPublicId } });
      if (stillUsed > 0) storage = 'kept_shared';
      else { const { destroyAsset } = await import('@/lib/cloudinary'); await destroyAsset({ id: document.cloudinaryPublicId }); }
    } catch (e: any) {
      storage = 'pending';
      console.warn('[Documents] Cloudinary cleanup failed:', e?.message);
    }
    await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, {
      action: 'DOCUMENT_DELETED', entityType: 'Document', entityId: id, entityLabel: document.fileName,
      description: `${document.category} "${document.fileName}" deleted from Documents${document.relatedEntityId ? ` (related ${document.relatedEntityType} ${document.relatedEntityLabel || document.relatedEntityId})` : ''}`,
      depotId: document.depotId, metadata: { document: { id, fileName: document.fileName, category: document.category }, storage: { status: storage, publicId: storage === 'pending' ? document.cloudinaryPublicId : null } },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
