import { NextRequest, NextResponse } from 'next/server';
import { checkOcrHealth } from '@/lib/ocr-client';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'settings.read');
  if (!auth.ok) return auth.response;
  const h = await checkOcrHealth();
  // The service URL and key are deliberately never returned.
  return NextResponse.json({
    connected: h.connected,
    statusText: h.statusText,
    reason: h.reason,
    detail: h.detail,
    isConfigured: h.configured,
    isAvailable: h.available,
    supportedFormats: ['application/pdf', 'image/jpeg', 'image/png'],
  });
}
