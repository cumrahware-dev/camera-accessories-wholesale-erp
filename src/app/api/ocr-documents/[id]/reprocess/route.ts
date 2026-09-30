import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { processDocument } from '@/lib/ocr/service';
import { errorResponse } from '@/lib/ocr/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

/** Sends the stored original through OCR again and refreshes THIS record. Never creates an ERP document. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'ocr.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json(await processDocument(id, { id: auth.user.id, name: auth.user.name }, 'reprocess'));
  } catch (e) {
    return errorResponse(e);
  }
}
