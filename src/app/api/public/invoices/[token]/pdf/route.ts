import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readShareToken } from '@/lib/documents/share-token';
import { buildDocumentPdf } from '@/lib/email/pdf';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = readShareToken('TAX_INVOICE', decodeURIComponent(token));
  const inv = id ? await prisma.taxInvoice.findUnique({ where: { id }, include: { items: true } }).catch(() => null) : null;
  if (!inv || inv.documentStatus === 'DRAFT') return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  try {
    const { buffer, fileName } = await buildDocumentPdf('TAX_INVOICE', inv);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'The PDF could not be generated.' }, { status: 500 });
  }
}
