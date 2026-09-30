import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { guardApi, depotIdFilter } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { uploadToCloudinary } from '@/lib/cloudinary';
import { OcrError, runOcr, toExtractedData } from '@/lib/ocr-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const MAX_BYTES = 15 * 1024 * 1024;
// One in-flight extraction per user+file: a double-click or repeated request is rejected, not re-processed.
const inFlight = new Set<string>();

function sniff(b: Buffer): { ext: string; mime: string } | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}

/**
 * Upload -> OCR service -> structured JSON for the Review screen.
 * This endpoint only READS the document. It never creates a proforma, invoice, customer or
 * product; those are created by /api/ai/save-extracted after the user clicks Confirm & Save.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  if (Number(req.headers.get('content-length') || 0) > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'File is too large (max 15 MB).', code: 'file_too_large' }, { status: 413 });
  }

  let lockKey = '';
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Upload the document as multipart form data.', code: 'bad_request' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.', code: 'no_file' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) return NextResponse.json({ error: 'The uploaded file is empty.', code: 'empty_file' }, { status: 400 });
    if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'File is too large (max 15 MB).', code: 'file_too_large' }, { status: 413 });
    const kind = sniff(buffer);
    if (!kind) return NextResponse.json({ error: 'Unsupported file. Upload a PDF, PNG or JPG.', code: 'unsupported_type' }, { status: 415 });

    const fileName = (file.name || `document.${kind.ext}`).slice(0, 200);
    lockKey = `${auth.user.id}:${createHash('sha256').update(buffer).digest('hex')}`;
    if (inFlight.has(lockKey)) {
      return NextResponse.json({ error: 'This document is already being processed.', code: 'duplicate_request' }, { status: 409 });
    }
    inFlight.add(lockKey);

    // The original is kept in Cloudinary/Documents in parallel with OCR; the OCR service
    // receives the bytes directly so the file is never downloaded a second time.
    const dataUri = `data:${kind.mime};base64,${buffer.toString('base64')}`;
    const [ocrResult, uploadResult] = await Promise.allSettled([
      runOcr(buffer, fileName),
      uploadToCloudinary(dataUri, 'camera-erp-dev2/ai-extractions', 'auto'),
    ]);
    if (ocrResult.status === 'rejected') throw ocrResult.reason;

    const extractedData = toExtractedData(ocrResult.value);
    let document: any = null;
    if (uploadResult.status === 'fulfilled') {
      const up = uploadResult.value as any;
      try {
        document = await prisma.cloudDocument.create({
          data: {
            title: `OCR: ${fileName.replace(/\.[^/.]+$/, '')}`,
            fileName,
            fileType: kind.mime,
            fileFormat: up.format || kind.ext,
            fileSize: up.bytes || buffer.length,
            cloudinaryUrl: up.secure_url || up.url,
            cloudinaryPublicId: up.public_id,
            category: 'PROFORMA',
            relatedEntityType: 'PROFORMA',
            relatedEntityId: '',
            relatedEntityLabel: 'Pending Confirmation',
            tags: ['OCR-EXTRACTED', kind.ext.toUpperCase()],
            uploadedBy: auth.user.id,
            uploadedByName: auth.user.name,
            depotId: depotIdFilter(auth.user) || null,
          },
        });
      } catch (e) {
        console.error('[OCR] could not register document');
      }
    }
    if (!document) {
      extractedData.warnings = [...(extractedData.warnings || []), 'The original file could not be stored in Documents. The data below was still read from your upload.'];
    }

    return NextResponse.json({
      success: true,
      extractedData,
      document,
      cloudinary: { secure_url: document?.cloudinaryUrl ?? null, public_id: document?.cloudinaryPublicId ?? null },
    });
  } catch (error: any) {
    if (error instanceof OcrError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[OCR] unexpected failure:', error?.message);
    return NextResponse.json({ error: 'Document reading failed unexpectedly.', code: 'internal' }, { status: 500 });
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
}
