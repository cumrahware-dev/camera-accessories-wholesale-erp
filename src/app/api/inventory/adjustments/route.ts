import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'inventory.adjust');
  if (!auth.ok) return auth.response;

  try {
    const { take, skip } = parsePagination(req);
    const adjustments = await prisma.stockAdjustment.findMany({ orderBy: { createdAt: 'desc' }, take, skip });
    return NextResponse.json(adjustments);
  } catch (error: any) {
    try {
      return NextResponse.json(dataStore.getAdjustments());
    } catch {
      return NextResponse.json([]);
    }
  }
}

/** Same as POST /api/inventory/adjust (kept for the Stock Adjustments screen): one audited, ledger-backed path. */
export { POST } from '../adjust/route';
