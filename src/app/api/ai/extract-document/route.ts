import { NextRequest, NextResponse } from 'next/server';
import { runPaddleOcr } from '@/lib/paddle-ocr';
import { parseInvoiceFromOcr } from '@/lib/ocr-parser';
import { uploadToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60s timeout for OCR polling

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  try {
    let fileBuffer: Buffer | null = null;
    let fileName = 'Uploaded_Document.pdf';
    let fileDataUri: string = '';
    let category = 'PROFORMA';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
      }
      fileName = file.name || 'document.pdf';
      const cat = formData.get('category') as string;
      if (cat) category = cat;

      const arrayBuffer = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      const base64String = fileBuffer.toString('base64');
      const mimeType = file.type || 'application/pdf';
      fileDataUri = `data:${mimeType};base64,${base64String}`;
    } else {
      const body = await req.json();
      const { fileData, fileName: reqFileName, category: reqCat } = body;

      if (!fileData) {
        return NextResponse.json({ error: 'fileData (Base64 string or data URI) is required' }, { status: 400 });
      }

      if (reqFileName) fileName = reqFileName;
      if (reqCat) category = reqCat;

      fileDataUri = fileData;
      // Extract raw base64 data if it is a data URI
      const base64Match = fileData.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (base64Match) {
        fileBuffer = Buffer.from(base64Match[2], 'base64');
      } else {
        fileBuffer = Buffer.from(fileData, 'base64');
        fileDataUri = `data:application/pdf;base64,${fileData}`;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return NextResponse.json({ error: 'File data could not be processed' }, { status: 400 });
    }

    // Validate by file signature, not by the client-supplied name/type.
    const MAX_BYTES = 15 * 1024 * 1024;
    if (fileBuffer.length > MAX_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 15 MB).' }, { status: 413 });
    }
    const head = fileBuffer.subarray(0, 12);
    const isPdf = head.subarray(0, 5).toString('latin1') === '%PDF-';
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isWebp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!isPdf && !isPng && !isJpg && !isWebp) {
      return NextResponse.json({ error: 'Unsupported file. Upload a PDF, JPG, PNG or WEBP.' }, { status: 415 });
    }

    // Run PaddleOCR first so a failed read leaves no orphan document behind.
    // Nothing becomes an invoice/proforma until the user reviews and confirms.
    console.log(`[AI Extraction] Processing "${fileName}" (${fileBuffer.length} bytes) via PaddleOCR...`);
    const ocr = await runPaddleOcr(fileBuffer, fileName);
    const extractedData = parseInvoiceFromOcr(ocr, fileName);

    // 1. Retain the original file (Cloudinary + Documents repository). If storage is unavailable
    //    the extraction is still returned for review, with a warning - never a fake document.
    let uploadRes: any = null;
    let cloudDoc: any = null;
    try {
      uploadRes = await uploadToCloudinary(fileDataUri, 'camera-erp-dev2/ai-extractions', 'auto');
      const format = uploadRes?.format || fileName.split('.').pop() || 'pdf';
      const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(String(format).toLowerCase());
      cloudDoc = await prisma.cloudDocument.create({
        data: {
          title: `AI Extracted: ${fileName.replace(/\.[^/.]+$/, '')}`,
          fileName,
          fileType: isImage ? `image/${format}` : 'application/pdf',
          fileFormat: format,
          fileSize: uploadRes?.bytes || fileBuffer.length,
          cloudinaryUrl: uploadRes.secure_url || uploadRes.url,
          cloudinaryPublicId: uploadRes.public_id,
          category: (category as any) || 'PROFORMA',
          relatedEntityType: 'PROFORMA',
          relatedEntityId: '',
          relatedEntityLabel: 'Pending Confirmation',
          tags: ['AI-EXTRACTED', 'PADDLE-OCR', String(format).toUpperCase()],
          uploadedBy: auth.user.id,
          uploadedByName: auth.user.name,
          depotId: depotIdFilter(auth.user) || null,
        },
      });
    } catch (storeErr: any) {
      console.warn('[AI Extraction] Original file was not stored:', storeErr?.message);
      extractedData.warnings = [
        ...(extractedData.warnings || []),
        'The original file could not be stored in Documents (storage unavailable). Data below is from the file you just uploaded.',
      ];
    }

    return NextResponse.json({
      success: true,
      extractedData,
      document: cloudDoc,
      cloudinary: {
        secure_url: cloudDoc?.cloudinaryUrl ?? null,
        public_id: cloudDoc?.cloudinaryPublicId ?? null,
      },
    });
  } catch (error: any) {
    console.error('[AI Document Extraction Route Error]:', error);
    return NextResponse.json(
      {
        error: error?.message || 'Failed to extract document via PaddleOCR',
      },
      { status: 500 }
    );
  }
}
