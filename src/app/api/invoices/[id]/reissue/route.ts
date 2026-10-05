import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { reissueInvoice } from '@/lib/services/invoice-service';
import { ServiceError } from '@/lib/services/proforma-service';

/**
 * POST { reason } — corrects an ISSUED invoice: it is cancelled (kept on record with its number) and a new DRAFT copy
 * is returned for editing. Refused once shipped or paid.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.taxInvoice.findFirst({ where: { OR: [{ id }, { invoiceNumber: id }] }, select: { id: true, depotId: true } });
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  const denied = assertDepotAccess(auth.user, existing.depotId);
  if (denied) return denied;

  try {
    const draft = await reissueInvoice(existing.id, body?.reason, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, clientIp(req));
    return NextResponse.json(draft, { status: 201 });
  } catch (e: any) {
    if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[Invoice reissue]', e);
    return NextResponse.json({ error: 'Could not correct the invoice.' }, { status: 500 });
  }
}
