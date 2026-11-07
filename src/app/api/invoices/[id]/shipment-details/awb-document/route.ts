import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { ShipmentDetailsError, attachAwbDocument, removeAwbDocument } from '@/lib/services/shipment-details';

export const dynamic = 'force-dynamic';

async function loadForAccess(id: string, user: any) {
  const inv = await prisma.taxInvoice.findUnique({ where: { id }, select: { id: true, depotId: true } });
  if (!inv) return { error: NextResponse.json({ error: 'Invoice not found.' }, { status: 404 }) };
  const denied = assertDepotAccess(user, inv.depotId);
  if (denied) return { error: denied };
  return { inv };
}

function fail(e: any) {
  if (e instanceof ShipmentDetailsError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[AWB document]', e?.message);
  return NextResponse.json({ error: 'The airway bill document could not be updated. Please try again.' }, { status: 500 });
}

/**
 * Attaches an uploaded airway bill to this invoice's shipment, replacing whatever was attached before.
 * Body: { documentId }. The file itself is uploaded first through the documents upload, so this only records
 * which document belongs to the shipment.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'invoices.shipment_details');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const a = await loadForAccess(id, auth.user);
  if (a.error) return a.error;
  const body = await req.json().catch(() => null);
  const documentId = String(body?.documentId || '').trim();
  if (!documentId) return NextResponse.json({ error: 'documentId is required.' }, { status: 400 });
  try {
    return NextResponse.json(await attachAwbDocument(id, documentId, { id: auth.user.id, name: auth.user.name, role: auth.user.role }));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Removes the airway bill document from this invoice's shipment.
 *
 * Anyone who may correct shipment details can take the wrong file off the shipment. Deleting the stored file as well
 * (?deleteFile=1) additionally needs the document-delete permission, so correcting an attachment can never destroy a
 * document by accident. The airway bill number and the other packing details are not touched.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'invoices.shipment_details');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const a = await loadForAccess(id, auth.user);
  if (a.error) return a.error;
  const wantsDelete = req.nextUrl.searchParams.get('deleteFile') === '1';
  if (wantsDelete && !hasPermission(auth.user.role, 'documents.delete')) {
    return NextResponse.json({ error: 'Deleting the stored file needs the document-delete permission. You can still remove it from this shipment.' }, { status: 403 });
  }
  try {
    return NextResponse.json(await removeAwbDocument(id, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, { deleteFile: wantsDelete }));
  } catch (e) {
    return fail(e);
  }
}
