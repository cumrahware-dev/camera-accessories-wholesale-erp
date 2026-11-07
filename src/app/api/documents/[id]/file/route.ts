import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { depotIdFilter, guardApi } from '@/lib/api-auth';
import { StoredFileError, readDocumentFile } from '@/lib/documents/stored-file';

export const dynamic = 'force-dynamic';

/**
 * Shows a stored document (airway bill, invoice copy, packing photo, ...) to a signed-in user.
 *
 *  - Access follows the user's permissions and depot scope. The storage provider's own URL is never handed out, so
 *    there is no public or expiring link to open and nothing depends on the provider's delivery settings.
 *  - The response carries the real content type (application/pdf for a PDF) and the original file name, so the browser
 *    opens it in its own viewer - no separate application needed. ?download=1 saves it instead.
 *  - A missing or unreadable file answers with a clear message instead of an HTML error page or a blank preview.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'documents.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const scoped = depotIdFilter(auth.user);
  if (scoped) {
    const own = await prisma.cloudDocument.findUnique({ where: { id }, select: { depotId: true } }).catch(() => null);
    if (!own) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    if (own.depotId && own.depotId !== scoped) {
      return NextResponse.json({ error: 'This document belongs to another depot.' }, { status: 403 });
    }
  }

  try {
    const { buffer, contentType, fileName } = await readDocumentFile(id);
    const download = req.nextUrl.searchParams.get('download') === '1';
    const safeName = fileName.replace(/[\r\n"\\]/g, '_');
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e: any) {
    if (e instanceof StoredFileError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[Document file]', e?.message);
    return NextResponse.json({ error: 'The document could not be opened.' }, { status: 500 });
  }
}
