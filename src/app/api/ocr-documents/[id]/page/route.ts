import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { readOriginal } from '@/lib/ocr/file-store';
import { OcrError, renderPdfPage } from '@/lib/ocr-client';

export const dynamic = 'force-dynamic';

/** One page of a PDF original as a PNG, so the review screen can highlight where a field was read. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'ocr.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const n = Math.floor(Number(req.nextUrl.searchParams.get('n') || 1));
  const doc = await prisma.ocrDocument.findUnique({ where: { id }, select: { storageProvider: true, storageKey: true, fileType: true, pageCount: true } });
  if (!doc) return NextResponse.json({ error: 'OCR document not found.' }, { status: 404 });
  if (doc.fileType !== 'application/pdf') return NextResponse.json({ error: 'Only PDF pages are rendered.' }, { status: 415 });
  if (!(n >= 1 && n <= Math.max(1, doc.pageCount || 1))) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  try {
    const png = await renderPdfPage(await readOriginal(doc.storageProvider, doc.storageKey), n);
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length), 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (e) {
    const status = e instanceof OcrError ? e.status : 404;
    return NextResponse.json({ error: e instanceof OcrError ? e.message : 'The stored file could not be read.' }, { status });
  }
}
