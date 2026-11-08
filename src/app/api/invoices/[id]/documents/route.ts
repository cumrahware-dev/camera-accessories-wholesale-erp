import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { SHIPMENT_CATEGORY_VALUES, categoryLabel } from '@/lib/documents/categories';

export const dynamic = 'force-dynamic';

/** Shipment documents of one invoice: its own uploads plus the airway bill linked to its shipment. Active records only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'documents.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const inv = await prisma.taxInvoice.findUnique({ where: { id }, select: { id: true, depotId: true } });
  if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const denied = assertDepotAccess(auth.user, inv.depotId);
  if (denied) return denied;
  const shipment = await prisma.shipment.findUnique({ where: { invoiceId: id }, select: { awbDocumentId: true } });
  const docs = await prisma.cloudDocument.findMany({
    where: { OR: [{ relatedEntityId: id, relatedEntityType: { in: ['INVOICE', 'SHIPMENT'] }, category: { in: SHIPMENT_CATEGORY_VALUES as any[] } }, ...(shipment?.awbDocumentId ? [{ id: shipment.awbDocumentId }] : [])] },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, title: true, fileName: true, fileType: true, fileFormat: true, fileSize: true, category: true, uploadedAt: true, uploadedByName: true },
  });
  const shipmentManager = hasPermission(auth.user.role, 'invoices.shipment_details') || hasPermission(auth.user.role, 'shipments.write');
  return NextResponse.json({
    canDelete: hasPermission(auth.user.role, 'documents.delete') || shipmentManager,
    documents: docs.map((d) => ({ ...d, categoryLabel: categoryLabel(d.category), href: `/api/documents/${d.id}/file`, isAwb: d.id === shipment?.awbDocumentId })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
