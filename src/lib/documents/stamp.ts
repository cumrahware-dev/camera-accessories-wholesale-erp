import 'server-only';
import { readFile } from 'fs/promises';
import path from 'path';

export type StampResult = { ok: true; dataUrl: string; format: 'PNG' | 'JPEG' } | { ok: false; reason: string };

const MAX_BYTES = 5 * 1024 * 1024;
const sniff = (b: Buffer): 'PNG' | 'JPEG' | null =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'PNG' : b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'JPEG' : null;

/**
 * Loads the company stamp (Settings -> Company seal image) for the PDF renderer. The setting is either a file served from
 * /public ("/arib-seal.png") or an https URL (uploaded image storage). Returns why it failed instead of throwing, so the
 * caller can tell the user: the stamp is never silently dropped.
 */
export async function loadStamp(url?: string | null): Promise<StampResult> {
  const src = String(url || '/arib-seal.png').trim();
  try {
    let buf: Buffer;
    if (src.startsWith('/')) {
      const pub = path.join(process.cwd(), 'public');
      const file = path.resolve(pub, '.' + src.split('?')[0]);
      if (!file.startsWith(pub + path.sep)) return { ok: false, reason: 'The stamp path is not inside the public folder.' };
      buf = await readFile(file);
    } else if (/^https:\/\//i.test(src)) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(src, { signal: ctl.signal, cache: 'no-store' });
        if (!r.ok) return { ok: false, reason: `The stamp image URL answered ${r.status}.` };
        const len = Number(r.headers.get('content-length') || 0);
        if (len > MAX_BYTES) return { ok: false, reason: 'The stamp image is larger than 5 MB.' };
        buf = Buffer.from(await r.arrayBuffer());
      } finally { clearTimeout(timer); }
    } else if (/^data:image\/(png|jpe?g);base64,/i.test(src)) {
      buf = Buffer.from(src.split(',')[1], 'base64');
    } else {
      return { ok: false, reason: 'The stamp image address is not a local file, an https URL or an embedded image.' };
    }
    if (buf.length > MAX_BYTES) return { ok: false, reason: 'The stamp image is larger than 5 MB.' };
    const format = sniff(buf);
    if (!format) return { ok: false, reason: 'The stamp file is not a PNG or JPEG image.' };
    return { ok: true, dataUrl: `data:image/${format === 'PNG' ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`, format };
  } catch (e: any) {
    return { ok: false, reason: e?.code === 'ENOENT' ? 'The stamp image file does not exist.' : `The stamp image could not be read (${e?.name === 'AbortError' ? 'timed out' : e?.message || 'error'}).` };
  }
}

export class StampError extends Error {}
