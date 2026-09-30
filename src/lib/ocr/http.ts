import 'server-only';
import { NextResponse } from 'next/server';
import { OcrModuleError } from './service';
import { OcrError } from '@/lib/ocr-client';

export function errorResponse(e: unknown) {
  if (e instanceof OcrModuleError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
  if (e instanceof OcrError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  console.error('[OCR module] unexpected error:', (e as any)?.message);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
