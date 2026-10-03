import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { readOriginal, storeOriginal } from '@/lib/ocr/file-store';
import { sniffFile } from '@/lib/ocr/service';
import { isCloudinaryError, userFacingCloudinaryMessage } from '@/lib/cloudinary';
import { setAttachment } from '@/lib/purchasing/price-support';
import { actorOf, purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
const MAX = 10 * 1024 * 1024;

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'price_support.read');
  if (!auth.ok) return auth.response;
  const s = await prisma.supplierPriceSupport.findUnique({ where: { id: (await params).id } });
  if (!s?.attachmentKey || !s.attachmentProvider) return NextResponse.json({ error: 'No attachment.' }, { status: 404 });
  try {
    const buf = await readOriginal(s.attachmentProvider, s.attachmentKey);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': s.attachmentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${(s.attachmentName || 'attachment').replace(/[^\w.\- ]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'The attachment could not be read from storage.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'price_support.write');
  if (!auth.ok) return auth.response;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
    if (buffer.length > MAX) return NextResponse.json({ error: 'File is too large (max 10 MB).' }, { status: 413 });
    const kind = sniffFile(buffer);
    if (!kind) return NextResponse.json({ error: 'Upload a PDF, JPG or PNG.' }, { status: 415 });
    let stored;
    try {
      stored = await storeOriginal(buffer, kind.mime, kind.ext, 'arib-global/price-support');
    } catch (e) {
      const detail = isCloudinaryError(e) ? userFacingCloudinaryMessage(e) : '';
      return NextResponse.json({ error: `File storage failed. ${detail}` }, { status: 503 });
    }
    const name = (file.name || `support.${kind.ext}`).slice(0, 200);
    return NextResponse.json(await setAttachment((await params).id, { name, type: kind.mime, provider: stored.provider, key: stored.key }, actorOf(auth.user)));
  } catch (e) {
    return purchasingError(e);
  }
}
