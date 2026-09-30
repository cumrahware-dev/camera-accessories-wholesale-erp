import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
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
    const body = await req.json();
    const depotId = depotIdFilter(auth.user);
    const CATEGORIES = ['AIRWAY_BILL', 'TAX_INVOICE', 'PROFORMA', 'PACKING_PHOTO', 'INSPECTION_REPORT', 'CUSTOMS_DOC', 'OTHER'];
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
    await prisma.cloudDocument.delete({ where: { id } });

    // Best-effort removal of the stored file so deleted documents do not linger in Cloudinary.
    try {
      const { deleteAsset } = await import('@/lib/cloudinary');
      await deleteAsset({ id: document.cloudinaryPublicId });
    } catch (e: any) {
      console.warn('[Documents] Cloudinary cleanup failed:', e?.message);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
