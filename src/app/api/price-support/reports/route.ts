import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { supportReport } from '@/lib/purchasing/price-support';
import { purchasingError } from '@/lib/purchasing/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'price_support.read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await supportReport(Object.fromEntries(req.nextUrl.searchParams)));
  } catch (e) {
    return purchasingError(e);
  }
}
