import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { hasPermission } from '@/lib/rbac';
import { isShipmentCategory } from '@/lib/documents/categories';
import { DocumentDeleteError, deleteInvoiceDocument } from '@/lib/documents/purge';

export const dynamic = 'force-dynamic';

/**
 * Deletes one shipment document of this invoice. Needs the document-delete permission, or - for shipment documents
 * (airway bill, packing list, challan, ...) - the right to manage shipment details. The id is only trusted after the
 * server has confirmed the document belongs to this invoice / its shipment.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  const { id, docId } = await params;
  try {
    const inv = await prisma.taxInvoice.findUnique({ where: { id }, select: { id: true, depotId: true } });
    if (!inv) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    const denied = assertDepotAccess(auth.user, inv.depotId);
    if (denied) return denied;
    const doc = await prisma.cloudDocument.findUnique({ where: { id: docId }, select: { category: true } });
    if (!doc) return NextResponse.json({ error: 'This document no longer exists. It may already have been deleted.' }, { status: 404 });
    const role = auth.user.role;
    const allowed = hasPermission(role, 'documents.delete') || (isShipmentCategory(doc.category) && (hasPermission(role, 'invoices.shipment_details') || hasPermission(role, 'shipments.write')));
    if (!allowed) return NextResponse.json({ error: 'You do not have permission to delete this document.' }, { status: 403 });
    const r = await deleteInvoiceDocument({ id: auth.user.id, name: auth.user.name, role }, id, docId, clientIp(req));
    return NextResponse.json({ success: true, ...r });
  } catch (e: any) {
    if (e instanceof DocumentDeleteError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[document delete]', e?.message);
    return NextResponse.json({ error: 'The document could not be deleted. Nothing was removed; please try again.' }, { status: 500 });
  }
}
