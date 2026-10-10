import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { getDetail, requestReprocess } from '@/lib/ocr/service';
import { enqueue } from '@/lib/ocr/queue';
import { errorResponse } from '@/lib/ocr/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

/** Queues the stored original for another OCR run that refreshes THIS record. Never creates an ERP document. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'ocr.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const user = { id: auth.user.id, name: auth.user.name };
    const body = await req.json().catch(() => ({}));
    await requestReprocess(id, user, { numberStyle: typeof body?.numberStyle === 'string' ? body.numberStyle : undefined, rememberForSupplier: body?.rememberForSupplier === true });
    enqueue(id, user, 'reprocess');
    return NextResponse.json(await getDetail(id), { status: 202 });
  } catch (e) {
    return errorResponse(e);
  }
}
