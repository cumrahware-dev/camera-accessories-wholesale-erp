import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { issueInvoice } from '@/lib/services/invoice-service';
import { ServiceError } from '@/lib/services/proforma-service';

/** DRAFT -> ISSUED: checks stock, assigns the invoice number and releases the order to the depot. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const invoice = await issueInvoice(id, { id: auth.user.id, name: auth.user.name, role: auth.user.role }, body?.expectedUpdatedAt);
    return NextResponse.json(invoice);
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, ...(error.extra || {}) }, { status: error.status });
    console.error('Error issuing invoice:', error);
    return NextResponse.json({ error: 'Failed to issue invoice.' }, { status: 500 });
  }
}
