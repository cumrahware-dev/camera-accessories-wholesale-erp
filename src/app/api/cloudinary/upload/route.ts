import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer, CloudinaryError, userFacingCloudinaryMessage } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const CATEGORIES = ['AIRWAY_BILL', 'TAX_INVOICE', 'PROFORMA', 'PACKING_PHOTO', 'INSPECTION_REPORT', 'CUSTOMS_DOC', 'OTHER'];
const ALLOWED: Record<string, { ext: string; sig: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: 'pdf', sig: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  'image/jpeg': { ext: 'jpg', sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', sig: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: 'webp', sig: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  try {
    if (Number(req.headers.get('content-length') || 0) > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File is too large (max 10 MB).' }, { status: 413 });
    }
    const body = await req.json();
    const {
      fileData, // data URI: data:<mime>;base64,<payload>
      fileName,
      category = 'OTHER',
      relatedEntityType = 'CUSTOMER',
      relatedEntityId = '',
      relatedEntityLabel = '',
      title,
      tags = [],
    } = body;

    if (typeof fileData !== 'string' || !fileData) {
      return NextResponse.json({ error: 'fileData (Base64 data URI) is required' }, { status: 400 });
    }
    if (!CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of ${CATEGORIES.join(', ')}` }, { status: 400 });
    }

    // Parse without a regex over the payload (large files overflow the regex engine).
    const marker = ';base64,';
    const markerAt = fileData.startsWith('data:') ? fileData.indexOf(marker) : -1;
    const mime = markerAt > 5 ? fileData.slice(5, markerAt).toLowerCase() : '';
    const spec = ALLOWED[mime];
    const m = markerAt > 0 ? [fileData, mime, fileData.slice(markerAt + marker.length)] : null;
    if (!m || !spec) {
      return NextResponse.json({ error: 'Unsupported file type. Upload a PDF, JPG, PNG or WEBP.' }, { status: 415 });
    }
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length === 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 10 MB).' }, { status: 413 });
    }
    // The declared type must match the actual bytes.
    if (!spec.sig(buffer)) {
      return NextResponse.json({ error: 'File content does not match its type. The file may be corrupt.' }, { status: 415 });
    }

    let uploadRes: any;
    try {
      uploadRes = await uploadBuffer(buffer, { mime, folder: `arib-global/${category.toLowerCase()}`, type: 'upload' });
    } catch (uploadErr: any) {
      // already logged (safe fields only) by the Cloudinary layer
      const detail = uploadErr instanceof CloudinaryError ? userFacingCloudinaryMessage(uploadErr) : 'Unexpected storage error.';
      return NextResponse.json({ error: `File storage failed. Nothing was saved. ${detail}`, stage: uploadErr?.stage }, { status: 503 });
    }

    const format = uploadRes.format || spec.ext;
    const cloudDoc = await prisma.cloudDocument.create({
      data: {
        title: String(title || fileName || `Document ${new Date().toLocaleDateString()}`).slice(0, 200),
        fileName: String(fileName || `Upload_${Date.now()}.${spec.ext}`).slice(0, 200),
        fileType: Object.keys(ALLOWED).find((k) => ALLOWED[k] === spec)!,
        fileFormat: format,
        fileSize: uploadRes.bytes || buffer.length,
        cloudinaryUrl: uploadRes.secure_url || uploadRes.url,
        cloudinaryPublicId: uploadRes.public_id,
        category,
        relatedEntityType,
        relatedEntityId,
        relatedEntityLabel,
        tags: Array.isArray(tags) ? tags.map(String).slice(0, 20) : [category],
        uploadedBy: auth.user.id,
        uploadedByName: auth.user.name,
        depotId: depotIdFilter(auth.user) || null,
      },
    });

    return NextResponse.json({
      success: true,
      document: cloudDoc,
      cloudinary: { secure_url: cloudDoc.cloudinaryUrl, public_id: cloudDoc.cloudinaryPublicId },
    });
  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
