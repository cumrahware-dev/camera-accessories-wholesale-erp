import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { deleteDocument, getDetail, OcrModuleError, updateDocument } from '@/lib/ocr/service';
import { previewConversion } from '@/lib/ocr/conversion';
import { destinationsFor, OcrDocType } from '@/lib/ocr/doc-types';
import { errorResponse } from '@/lib/ocr/http';
import { enqueue, isQueued } from '@/lib/ocr/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'ocr.read');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const detail = await getDetail(id);
    // Polling doubles as a safety net: a queued job that no worker in this process holds (restart, serverless
    // freeze) is started again instead of waiting forever. processDocument's atomic claim prevents double runs.
    if (detail.processingStatus === 'UPLOADED' && !isQueued(id) && Date.now() - detail.updatedAt.getTime() > 15_000) {
      enqueue(id, { id: auth.user.id, name: auth.user.name });
    }
    // Validation for every destination this type can go to, so the UI can show problems before the user clicks Convert.
    const checks: Record<string, unknown> = {};
    for (const d of destinationsFor(detail.documentType as OcrDocType)) {
      checks[d.key] = d.available && detail.processingStatus !== 'FAILED'
        ? await previewConversion(id, d.key).catch(() => ({ errors: ['Validation could not run.'], warnings: [], duplicates: [] }))
        : { errors: d.available ? [] : [`${d.label} is not available in this ERP.`], warnings: [], duplicates: [] };
    }
    return NextResponse.json({ ...detail, checks });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'ocr.write');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const patch = await req.json().catch(() => null);
    if (!patch || typeof patch !== 'object') throw new OcrModuleError(400, 'Invalid request body.');
    return NextResponse.json(await updateDocument(id, patch, { id: auth.user.id, name: auth.user.name }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'ocr.delete');
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const doc = await getDetail(id);
    if (doc.conversionStatus === 'CONVERTED' && req.nextUrl.searchParams.get('confirmConverted') !== 'true') {
      throw new OcrModuleError(409, `This document was converted to ${doc.convertedDocumentNumber}. Deleting it only removes the OCR record, not the ERP document. Confirm to continue.`, { code: 'converted_confirm_required' });
    }
    return NextResponse.json(await deleteDocument(id, { id: auth.user.id, name: auth.user.name }));
  } catch (e) {
    return errorResponse(e);
  }
}
