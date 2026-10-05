import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { updateDraftInvoice } from '@/lib/services/invoice-service';
import { ServiceError } from '@/lib/services/proforma-service';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/invoices/[id]/items
 * Replaces the line items of a DRAFT tax invoice:
 *   body: { items: [{ id?: string, productId: string, quantity: number, unitPrice: number, discountPercent?, taxRate? }] }
 * Same rules, calculator and audit trail as PUT /api/invoices/[id]/draft. An issued invoice is final: it is corrected
 * with Cancel & Reissue, never edited in place.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  if (!Array.isArray(body?.items) || body.items.length === 0) return NextResponse.json({ error: 'An invoice needs at least one item.' }, { status: 400 });

  const existing = await prisma.taxInvoice.findUnique({ where: { id }, select: { id: true, depotId: true } });
  if (!existing) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const denied = assertDepotAccess(auth.user, existing.depotId);
  if (denied) return denied;

  try {
    const { invoice } = await updateDraftInvoice(id, { items: body.items }, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, clientIp(req));
    return NextResponse.json({ success: true, invoice });
  } catch (e: any) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
    console.error('Invoice item update failed:', e);
    return NextResponse.json({ error: 'Could not save the invoice items.' }, { status: 500 });
  }
}
