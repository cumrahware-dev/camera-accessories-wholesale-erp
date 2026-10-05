import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { countTables, NOT_INCLUDED } from '@/lib/backup/app-export';
import { dumpAvailability } from '@/lib/backup/db-dump';

export const dynamic = 'force-dynamic';

/** Data & Backup overview: what an export contains, whether a full database dump is possible here, and the run history. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  try {
    const [tables, runs, dump] = await Promise.all([
      countTables(),
      prisma.backupRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      dumpAvailability(),
    ]);
    return NextResponse.json({ tables, notIncluded: NOT_INCLUDED, runs, databaseBackup: dump }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[backup] overview failed:', e?.message);
    return NextResponse.json({ error: 'Could not load backup information.' }, { status: 500 });
  }
}
