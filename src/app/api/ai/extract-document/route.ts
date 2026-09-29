import { NextRequest, NextResponse } from 'next/server';
import { runPaddleOcr } from '@/lib/paddle-ocr';
import { parseInvoiceFromOcr } from '@/lib/ocr-parser';
import { uploadToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
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

    // 1. Upload original document to Cloudinary to ensure document retention
    let uploadRes: any = null;
    try {
      uploadRes = await uploadToCloudinary(
        fileDataUri,
        'camera-erp-dev2/ai-extractions',
        'auto'
      );
    } catch (cloudErr: any) {
      console.warn('[AI Extraction] Cloudinary upload fallback:', cloudErr?.message);
    }

    // 2. Register in Centralized Documents Repository
    const format = uploadRes?.format || fileName.split('.').pop() || 'pdf';
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(format.toLowerCase());
    const fileType = isImage ? `image/${format}` : 'application/pdf';

    const docData = {
      title: `AI Extracted: ${fileName.replace(/\.[^/.]+$/, '')}`,
      fileName,
      fileType,
      fileFormat: format,
      fileSize: uploadRes?.bytes || fileBuffer.length,
      cloudinaryUrl: uploadRes?.secure_url || uploadRes?.url || fileDataUri,
      cloudinaryPublicId: uploadRes?.public_id || `ai_doc_${Date.now()}`,
      category: (category as any) || 'PROFORMA',
      relatedEntityType: 'PROFORMA' as any,
      relatedEntityId: '',
      relatedEntityLabel: 'Pending Confirmation',
      tags: ['AI-EXTRACTED', 'PADDLE-OCR', format.toUpperCase()],
      uploadedBy: auth.user.id,
      uploadedByName: auth.user.name,
      depotId: depotIdFilter(auth.user) || null,
      notes: 'Extracted using PaddleOCR; pending manual review',
    };

    let cloudDoc: any = null;
    try {
      cloudDoc = await prisma.cloudDocument.create({
        data: docData,
      });
      dataStore.createDocument(cloudDoc);
    } catch {
      cloudDoc = dataStore.createDocument(docData);
    }

    return NextResponse.json({
      success: true,
      extractedData,
      document: cloudDoc,
      cloudinary: {
        secure_url: uploadRes?.secure_url || cloudDoc?.cloudinaryUrl,
        public_id: uploadRes?.public_id || cloudDoc?.cloudinaryPublicId,
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
