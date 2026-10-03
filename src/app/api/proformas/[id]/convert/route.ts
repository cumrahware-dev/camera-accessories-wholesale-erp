import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { deductStockForInvoice } from '@/lib/inventory-service';
import { broadcastSystemEvent } from '@/lib/events-emitter';
import { guardApi } from '@/lib/api-auth';
import { convertProformaToInvoice, ServiceError } from '@/lib/services/proforma-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await guardApi(req, 'invoices.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { depotId } = body;

    const invoice = await convertProformaToInvoice(id, depotId, { id: auth.user.id, name: auth.user.name, role: auth.user.role });
    return NextResponse.json(invoice, { status: 201 });
  } catch (error: any) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message, ...(error.extra || {}) }, { status: error.status });
    console.error('Error converting proforma:', error);
    return NextResponse.json({ error: error.message || 'Conversion failed' }, { status: 500 });
  }
}
