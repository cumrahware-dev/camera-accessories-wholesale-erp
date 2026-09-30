import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { convertDocument } from '@/lib/ocr/conversion';
import { errorResponse } from '@/lib/ocr/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'ocr.convert');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const res = await convertDocument(
      id,
      { destination: body.destination, acknowledgeDuplicates: body.acknowledgeDuplicates === true, acknowledgeInvoiceWorkflow: body.acknowledgeInvoiceWorkflow === true, depotId: body.depotId || undefined },
      { id: auth.user.id, name: auth.user.name, role: auth.user.role }
    );
    return NextResponse.json({ success: true, link: res.link, number: res.number, type: res.type, document: res.detail });
  } catch (e) {
    return errorResponse(e);
  }
}
