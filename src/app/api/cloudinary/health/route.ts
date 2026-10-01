import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { runCloudinaryHealth } from '@/lib/cloudinary-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cloudinary/health            → configuration + connection check
 * GET /api/cloudinary/health?upload=1   → also uploads/verifies/deletes test assets in arib-global/ocr-test/
 * Signed-in administrators only. Never returns secrets.
 */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const upload = req.nextUrl.searchParams.get('upload') === '1';
  const result = await runCloudinaryHealth({ upload });
  return NextResponse.json(result, { status: result.ok ? 200 : result.configured ? 502 : 503, headers: { 'Cache-Control': 'no-store' } });
}
