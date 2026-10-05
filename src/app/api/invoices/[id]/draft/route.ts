import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { previewDraftInvoice, updateDraftInvoice } from '@/lib/services/invoice-service';
import { ServiceError } from '@/lib/services/proforma-service';

export const dynamic = 'force-dynamic';

/**
 * Editing a DRAFT tax invoice (one converted from a proforma, created directly, or a reissue).
 *   POST = preview: recalculated totals, stock position and warnings for the edit; nothing is saved
 *   PUT  = save the edit (audited field by field). The source proforma is never changed.
 * Body (every field optional): customerId, applyCustomerDefaults, depotId, paymentTerms, paymentMethod, incoterm,
 * incotermPlace, deliveryTerms, discountPercent, otherCharges, freight { isManualOverride, manualTotalFreight,
 * freightRatePerKg, additionalFreightCharges }, notes, items [{ id?, productId, quantity, unitPrice, discountPercent, taxRate }],
 * expectedUpdatedAt (save only: refuses to overwrite someone else's newer change).
 */
async function handle(req: NextRequest, params: Promise<{ id: string }>, save: boolean) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const existing = await prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, select: { id: true, depotId: true } });
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  const denied = assertDepotAccess(auth.user, existing.depotId);
  if (denied) return denied;

  try {
    if (!save) return NextResponse.json(await previewDraftInvoice(existing.id, body));
    return NextResponse.json(await updateDraftInvoice(existing.id, body, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, clientIp(req)));
  } catch (e: any) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
    console.error('[Invoice draft]', e);
    return NextResponse.json({ error: save ? 'Could not save the invoice.' : 'Could not recalculate the invoice.' }, { status: 500 });
  }
}

export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => handle(req, params, false);
export const PUT = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => handle(req, params, true);
