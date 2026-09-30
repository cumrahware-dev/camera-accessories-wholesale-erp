import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { createFromUpload, listDocuments } from '@/lib/ocr/service';
import { enqueue, recoverJobs } from '@/lib/ocr/queue';
import { errorResponse } from '@/lib/ocr/http';
import { parsePagination } from '@/lib/pagination';
import { createHash } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const inFlight = new Set<string>();

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'ocr.read');
  if (!auth.ok) return auth.response;
  try {
    await recoverJobs();
    const sp = req.nextUrl.searchParams;
    const { take, skip } = parsePagination(req, { defaultLimit: 25, maxLimit: 100 });
    const res = await listDocuments({
      q: sp.get('q')?.trim() || undefined, type: sp.get('type') || undefined, status: sp.get('status') || undefined,
      conversion: sp.get('conversion') || undefined, from: sp.get('from') || undefined, to: sp.get('to') || undefined,
      page: Math.floor(skip / take) + 1, limit: take,
    });
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Upload -> queue. The file is stored and a job is queued; OCR runs in the background worker, so this
 * request returns immediately and the UI never waits on OCR. Creates an OCR record only, never an ERP document.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'ocr.write');
  if (!auth.ok) return auth.response;
  if (Number(req.headers.get('content-length') || 0) > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 413 });
  }
  let lock = '';
  try {
    await recoverJobs();
    let form: FormData;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Upload the document as multipart form data.' }, { status: 400 }); }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    lock = createHash('sha256').update(buffer).digest('hex');
    if (inFlight.has(lock)) return NextResponse.json({ error: 'This document is already being uploaded.' }, { status: 409 });
    inFlight.add(lock);

    const user = { id: auth.user.id, name: auth.user.name };
    const doc = await createFromUpload({ buffer, fileName: file.name || 'document', user, allowDuplicate: form.get('allowDuplicate') === 'true' });
    enqueue(doc.id, user);
    return NextResponse.json({ success: true, id: doc.id, status: 'UPLOADED' }, { status: 202 });
  } catch (e) {
    return errorResponse(e);
  } finally {
    if (lock) inFlight.delete(lock);
  }
}
