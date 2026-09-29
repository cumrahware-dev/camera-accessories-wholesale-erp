import { NextRequest, NextResponse } from 'next/server';
import { checkPaddleAvailable } from '@/lib/paddle-ocr';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'settings.read');
  if (!auth.ok) return auth.response;

  const status = await checkPaddleAvailable();
  return NextResponse.json({
    isConfigured: status.available,
    engine: 'PaddleOCR',
    detail: status.detail,
    supportedFormats: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  });
}
