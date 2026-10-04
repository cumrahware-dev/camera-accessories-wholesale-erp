import { NextRequest, NextResponse } from 'next/server';
import { guardApi, assertDepotAccess } from '@/lib/api-auth';
import { loadDocument } from '@/lib/email/document-email';
import { buildDocumentPdf } from '@/lib/email/pdf';
import { docAccess } from '../../../email/_shared';

export const dynamic = 'force-dynamic';

/** Downloads the exact PDF that is attached to the customer email. ?inline=1 opens it in the browser. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  const { type: rawType, id } = await params;
  const { type, denied } = docAccess(auth.user.role, rawType.toUpperCase(), 'read');
  if (denied) return denied;
  const doc = await loadDocument(type!, id).catch(() => null);
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  if (type === 'TAX_INVOICE') {
    const depotDenied = assertDepotAccess(auth.user, doc.depotId);
    if (depotDenied) return depotDenied;
  }
  try {
    const { buffer, fileName } = await buildDocumentPdf(type!, doc);
    const disposition = req.nextUrl.searchParams.get('inline') === '1' ? 'inline' : 'attachment';
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e: any) {
    console.error('[PDF] generation failed:', e?.message);
    return NextResponse.json({ error: 'The PDF could not be generated.' }, { status: 500 });
  }
}
