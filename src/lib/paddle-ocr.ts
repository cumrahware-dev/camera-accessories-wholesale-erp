/**
 * PaddleOCR bridge. Runs scripts/ocr/paddle_ocr.py (PaddleOCR for scans and
 * images, embedded text layer for digital PDFs) and returns raw text lines.
 * Structuring happens in ocr-parser.ts.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface OcrLine {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrPage {
  page: number;
  source: 'text-layer' | 'ocr';
  width: number;
  height: number;
  lines: OcrLine[];
}
export interface OcrResult {
  engine: 'paddleocr';
  pageCount: number;
  truncated?: boolean;
  pages: OcrPage[];
}

const SCRIPT = path.join(process.cwd(), 'scripts', 'ocr', 'paddle_ocr.py');
const TIMEOUT_MS = Number(process.env.PADDLEOCR_TIMEOUT_MS || 170_000);

export function getPaddleConfig() {
  return {
    python: process.env.PADDLEOCR_PYTHON || 'python3',
    script: SCRIPT,
  };
}

/** Checks the python runtime can import paddleocr (used by the settings page). */
export function checkPaddleAvailable(): Promise<{ available: boolean; detail: string }> {
  const { python } = getPaddleConfig();
  return new Promise((resolve) => {
    const p = spawn(python, ['-c', 'import paddleocr, pymupdf; print(paddleocr.__version__)']);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ available: false, detail: e.message }));
    p.on('close', (code) =>
      resolve(code === 0 ? { available: true, detail: `PaddleOCR ${out.trim()}` } : { available: false, detail: err.trim().split('\n').pop() || 'import failed' })
    );
  });
}

export async function runPaddleOcr(buffer: Buffer, fileName: string): Promise<OcrResult> {
  // Pick the extension from the file signature; the client-supplied name can lie.
  const ext = buffer.subarray(0, 5).toString('latin1') === '%PDF-' ? '.pdf'
    : buffer[0] === 0x89 ? '.png'
    : buffer[0] === 0xff ? '.jpg'
    : buffer.subarray(0, 4).toString('latin1') === 'RIFF' ? '.webp'
    : '.pdf';
  void fileName;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arib-ocr-'));
  const file = path.join(dir, `input${ext}`);
  try {
    await fs.writeFile(file, buffer);
    const { python, script } = getPaddleConfig();
    return await new Promise<OcrResult>((resolve, reject) => {
      const p = spawn(python, [script, file], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        reject(new Error('PaddleOCR timed out. Try a smaller or clearer file.'));
      }, TIMEOUT_MS);
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`PaddleOCR runtime not available (${e.message}). Install with: pip install paddleocr paddlepaddle pymupdf`));
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        const jsonStart = out.indexOf('{"');
        if (jsonStart < 0) {
          const tail = err.trim().split('\n').slice(-2).join(' ');
          return reject(new Error(`PaddleOCR failed (exit ${code}): ${tail || 'no output'}`));
        }
        try {
          const parsed = JSON.parse(out.slice(jsonStart));
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed as OcrResult);
        } catch {
          reject(new Error('PaddleOCR returned unreadable output'));
        }
      });
    });
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
