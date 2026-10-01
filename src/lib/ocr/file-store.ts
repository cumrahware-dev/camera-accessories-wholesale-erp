/**
 * Storage for the original uploaded file.
 * Cloudinary when configured (production); otherwise a local folder for development.
 *
 * The original is uploaded exactly once (streamed, no temp file) as an *authenticated* asset:
 * it is read back through a signed API URL, so OCR/reprocess/preview never depend on public
 * delivery being enabled for PDFs on the Cloudinary account.
 */
import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  CloudinaryError, deleteAsset, downloadAsset, isCloudinaryConfigured, isCloudinaryPartial,
  getCloudinaryDiagnostics, uploadBuffer, type AssetRef,
} from '@/lib/cloudinary';

const LOCAL_DIR = process.env.OCR_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.ocr-files');
export const OCR_CLOUDINARY_FOLDER = 'arib-global/ocr';

export const cloudinaryConfigured = isCloudinaryConfigured;

export interface StoredFile { provider: 'cloudinary' | 'local'; key: string }

export async function storeOriginal(buffer: Buffer, mime: string, ext: string): Promise<StoredFile> {
  if (isCloudinaryPartial()) {
    // a half-set configuration is a deployment mistake: never hide it behind a silent local fallback
    const d = getCloudinaryDiagnostics();
    throw new CloudinaryError('config', `Cloudinary is only partly configured. ${d.problems.filter((p) => /missing/i.test(p)).join('; ')}`, 0, 'NotConfigured',
      'Set all of CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (or CLOUDINARY_URL) on the service that runs Next.js, then redeploy.');
  }
  if (isCloudinaryConfigured()) {
    const up = await uploadBuffer(buffer, { mime, folder: OCR_CLOUDINARY_FOLDER, type: 'authenticated' });
    const ref: AssetRef & { v: 2 } = { v: 2, id: up.public_id, rt: up.resource_type === 'raw' ? 'raw' : 'image', type: 'authenticated', fmt: up.format };
    return { provider: 'cloudinary', key: JSON.stringify(ref) };
  }
  try {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(LOCAL_DIR, key), buffer);
    return { provider: 'local', key };
  } catch (e: any) {
    throw new CloudinaryError('config', `No file storage is available: Cloudinary is not configured on this server and the local folder is not writable (${e?.code || e?.message}).`, 0, 'NotConfigured',
      'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on the service that runs Next.js, then redeploy.');
  }
}

function parseRef(key: string): AssetRef {
  const j = JSON.parse(key);
  if (j.v === 2) return j as AssetRef;
  // legacy record: { id, url } – uploaded with resource_type "auto" as a public asset
  const rt = /\/raw\/upload\//.test(j.url || '') ? 'raw' : 'image';
  const fmt = rt === 'image' ? (String(j.url || '').split('?')[0].split('.').pop() || '') : '';
  return { id: j.id, rt, type: 'upload', fmt, url: j.url };
}

export async function readOriginal(provider: string, key: string): Promise<Buffer> {
  if (provider === 'cloudinary') return downloadAsset(parseRef(key));
  const safe = path.basename(key); // never trust the key as a path
  return fs.readFile(path.join(LOCAL_DIR, safe));
}

export async function removeOriginal(provider: string, key: string): Promise<void> {
  try {
    if (provider === 'cloudinary') await deleteAsset(parseRef(key));
    else await fs.rm(path.join(LOCAL_DIR, path.basename(key)), { force: true });
  } catch (e: any) {
    console.warn('[OCR] could not remove stored file:', e?.message);
  }
}
