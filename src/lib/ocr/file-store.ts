/**
 * Storage for the original uploaded file.
 * Cloudinary when configured (production); otherwise a local folder for development.
 */
import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { uploadToCloudinary, cloudinary } from '@/lib/cloudinary';

const LOCAL_DIR = process.env.OCR_LOCAL_STORAGE_DIR || path.join(process.cwd(), '.ocr-files');

export const cloudinaryConfigured = () =>
  Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

export interface StoredFile { provider: 'cloudinary' | 'local'; key: string }

export async function storeOriginal(buffer: Buffer, mime: string, ext: string): Promise<StoredFile> {
  if (cloudinaryConfigured()) {
    const up = (await uploadToCloudinary(`data:${mime};base64,${buffer.toString('base64')}`, 'camera-erp-dev2/ocr', 'auto')) as any;
    // key carries what we need to fetch it again
    return { provider: 'cloudinary', key: JSON.stringify({ id: up.public_id, url: up.secure_url || up.url }) };
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const key = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(LOCAL_DIR, key), buffer);
  return { provider: 'local', key };
}

export async function readOriginal(provider: string, key: string): Promise<Buffer> {
  if (provider === 'cloudinary') {
    const { url } = JSON.parse(key);
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Stored file could not be fetched (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  const safe = path.basename(key); // never trust the key as a path
  return fs.readFile(path.join(LOCAL_DIR, safe));
}

export async function removeOriginal(provider: string, key: string): Promise<void> {
  try {
    if (provider === 'cloudinary') {
      const { id } = JSON.parse(key);
      const r = await cloudinary.uploader.destroy(id, { resource_type: 'image' });
      if (r?.result === 'not found') await cloudinary.uploader.destroy(id, { resource_type: 'raw' });
    } else {
      await fs.rm(path.join(LOCAL_DIR, path.basename(key)), { force: true });
    }
  } catch (e: any) {
    console.warn('[OCR] could not remove stored file:', e?.message);
  }
}
