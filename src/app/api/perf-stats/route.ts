import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { perfStats } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Profiling only. Returns 404 unless the server was started with PERF_LOG=1, and then only to a Super Admin.
 *   GET  -> { count, ms }  query counter since the last reset
 *   POST -> resets the counter and returns what it held (with the per-query log)
 */
async function gate(req: NextRequest) {
  if (process.env.PERF_LOG !== '1') return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  const auth = await guardApi(req);
  if (!auth.ok) return { res: auth.response };
  if (auth.user.role !== 'SUPER_ADMIN') return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { res: null };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  return NextResponse.json({ count: perfStats.count, ms: perfStats.ms });
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.res) return g.res;
  const snapshot = { count: perfStats.count, ms: perfStats.ms, log: perfStats.log.slice() };
  perfStats.count = 0; perfStats.ms = 0; perfStats.log.length = 0;
  return NextResponse.json(snapshot);
}
