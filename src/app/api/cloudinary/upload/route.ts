import { NextRequest, NextResponse } from 'next/server';
import { uploadToCloudinary } from '@/lib/cloudinary';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { depotIdFilter, guardApi } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      fileData, // Base64 data URI: data:image/jpeg;base64,... or data:application/pdf;base64,...
      fileName,
      category = 'OTHER',
      relatedEntityType = 'CUSTOMER',
      relatedEntityId = '',
      relatedEntityLabel = '',
      title,
      tags = [],
      replaceDocumentId,
    } = body;

    if (!fileData) {
      return NextResponse.json({ error: 'fileData (Base64 string) is required' }, { status: 400 });
    }

    // When replacing an existing document, reuse its category/entity linkage
    // so the new file lands in the same place the old one did.
    let existingDoc: any = null;
    if (replaceDocumentId) {
      try {
        existingDoc = await prisma.cloudDocument.findUnique({ where: { id: replaceDocumentId } });
      } catch {}
      if (!existingDoc) {
        existingDoc = dataStore.getDocuments().find((d) => d.id === replaceDocumentId) || null;
      }
      if (!existingDoc) {
        return NextResponse.json({ error: 'Document to replace was not found' }, { status: 404 });
      }
      const scopedDepotId = depotIdFilter(auth.user);
      if (scopedDepotId && existingDoc.depotId && existingDoc.depotId !== scopedDepotId) {
        return NextResponse.json({ error: 'Forbidden: document is outside your assigned depot' }, { status: 403 });
      }
    }

    const finalCategory = existingDoc?.category || category;

    // Upload to Cloudinary using configured credentials with local fallback
    let uploadRes: any = null;
    try {
      uploadRes = await uploadToCloudinary(
        fileData,
        `camera-erp-dev2/${finalCategory.toLowerCase()}`,
        'auto'
      );
    } catch (uploadErr: any) {
      console.warn('Cloudinary upload fallback activated:', uploadErr?.message);
    }

    // Determine format & file type
    const format =
      uploadRes?.format ||
      (fileName ? fileName.split('.').pop() || 'pdf' : 'pdf');
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(format.toLowerCase());
    const fileType = isImage ? `image/${format}` : 'application/pdf';

    const docData = {
      title: title || existingDoc?.title || fileName || `Document ${new Date().toLocaleDateString()}`,
      fileName: fileName || `Upload_${Date.now()}.${format}`,
      fileType,
      fileFormat: format,
      fileSize: uploadRes?.bytes || (fileData ? Math.round(fileData.length * 0.75) : 150000),
      cloudinaryUrl: uploadRes?.secure_url || uploadRes?.url || fileData,
      cloudinaryPublicId: uploadRes?.public_id || `doc_${Date.now()}`,
      category: finalCategory as any,
      relatedEntityType: existingDoc?.relatedEntityType || relatedEntityType,
      relatedEntityId: existingDoc?.relatedEntityId || relatedEntityId,
      relatedEntityLabel: existingDoc?.relatedEntityLabel || relatedEntityLabel,
      tags: Array.isArray(tags) ? tags : existingDoc?.tags || [finalCategory],
      uploadedBy: auth.user.id,
      uploadedByName: auth.user.name,
      depotId: existingDoc?.depotId ?? (depotIdFilter(auth.user) || null),
    };

    // Register in centralized Cloud Documents Hub with fallback — replacing
    // the existing row in place (same id) when this is a replace operation,
    // so links elsewhere to this document keep working.
    let cloudDoc: any = null;
    if (existingDoc) {
      try {
        cloudDoc = await prisma.cloudDocument.update({
          where: { id: existingDoc.id },
          data: docData,
        });
        dataStore.updateDocument(existingDoc.id, cloudDoc);
      } catch {
        cloudDoc = dataStore.updateDocument(existingDoc.id, docData);
      }
    } else {
      try {
        cloudDoc = await prisma.cloudDocument.create({
          data: docData,
        });
        dataStore.createDocument(cloudDoc);
      } catch {
        cloudDoc = dataStore.createDocument(docData);
      }
    }

    return NextResponse.json({
      success: true,
      document: cloudDoc,
      cloudinary: {
        secure_url: uploadRes?.secure_url || cloudDoc?.cloudinaryUrl || fileData,
        public_id: uploadRes?.public_id || cloudDoc?.cloudinaryPublicId || `doc_${Date.now()}`,
      },
    });
  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
