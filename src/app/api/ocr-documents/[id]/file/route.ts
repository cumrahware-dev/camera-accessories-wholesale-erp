import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { readOriginal } from '@/lib/ocr/file-store';

export const dynamic = 'force-dynamic';

/** Streams the original through the ERP so access follows OCR permissions (no public file URL). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'ocr.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const doc = await prisma.ocrDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: 'OCR document not found.' }, { status: 404 });
  try {
    const buf = await readOriginal(doc.storageProvider, doc.storageKey);
    const download = req.nextUrl.searchParams.get('download') === '1';
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.fileType,
        'Content-Length': String(buf.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(doc.fileName)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'The stored file could not be read.' }, { status: 404 });
  }
}
