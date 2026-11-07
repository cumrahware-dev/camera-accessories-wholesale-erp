import 'server-only';
import { prisma } from '@/lib/prisma';
import { downloadAsset, isCloudinaryError, resourceTypeFor } from '@/lib/cloudinary';

/**
 * Reads a stored document (airway bill, invoice copy, packing photo, ...) back out of the existing document storage.
 *
 * The ONE place that turns a CloudDocument record into bytes, used both by the route that shows a document to a
 * signed-in user and by the email worker that attaches one. It asks the storage provider through a signed request, so
 * it also works for assets whose public delivery is switched off (a common Cloudinary account setting for PDFs).
 */
export class StoredFileError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const TYPE_BY_FORMAT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const SERVABLE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** The content type to serve a document with: its recorded type, else its stored format, else a plain download. */
export function contentTypeOf(doc: { fileType?: string | null; fileFormat?: string | null }): string {
  const t = String(doc.fileType || '');
  if (SERVABLE.has(t)) return t;
  const f = String(doc.fileFormat || '').toLowerCase().replace(/^\./, '');
  return TYPE_BY_FORMAT[f] || 'application/octet-stream';
}

export async function readDocumentFile(documentId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string; doc: any }> {
  const doc = await prisma.cloudDocument.findUnique({ where: { id: documentId } }).catch(() => null);
  if (!doc) throw new StoredFileError(404, 'Document not found.');
  const contentType = contentTypeOf(doc);
  const format = String(doc.fileFormat || '').toLowerCase().replace(/^\./, '');

  let buffer: Buffer;
  try {
    buffer = await downloadAsset({ id: doc.cloudinaryPublicId, rt: resourceTypeFor(contentType), type: 'upload', fmt: format, url: doc.cloudinaryUrl });
  } catch (e: any) {
    const missing = isCloudinaryError(e) && (e.httpCode === 404 || /not found/i.test(e.message));
    console.error(`[Document] ${documentId} could not be read:`, isCloudinaryError(e) ? `${e.httpCode} ${e.message}` : e?.message);
    throw new StoredFileError(
      missing ? 404 : 502,
      missing
        ? 'This document is no longer in document storage, so it cannot be opened. Upload the file again.'
        : 'The document could not be read from document storage. Try again; if it keeps failing, ask your administrator to check the storage configuration.'
    );
  }
  if (!buffer.length) throw new StoredFileError(404, 'The stored document is empty, so there is nothing to open.');
  return { buffer, contentType, fileName: doc.fileName || `document.${format || 'bin'}`, doc };
}
