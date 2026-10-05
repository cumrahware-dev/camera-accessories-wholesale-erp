import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';
import { dumpAvailability, startDump } from '@/lib/backup/db-dump';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Full database backup (pg_dump, custom format). Super Admin only. Works only where pg_dump exists on this server;
 * otherwise it answers 501 and says why, so nothing is ever presented as a backup that is not one.
 * NOTE: a full dump contains EVERYTHING in the database, including password hashes. Keep the file private.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const avail = await dumpAvailability();
  if (!avail.available) {
    return NextResponse.json({ error: `A full database backup cannot be created from here. ${avail.reason} Use your database provider's backup / point-in-time recovery.` }, { status: 501 });
  }
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const fileName = `ARIB_GLOBAL_database_${stamp}.dump`;
  try {
    const stream = startDump((r) => {
      void prisma.backupRun.create({ data: { kind: 'DB_DUMP', status: r.error ? 'FAILED' : 'COMPLETED', fileName, sizeBytes: Math.min(r.bytes, 2_000_000_000), note: r.error || avail.version || '', createdById: actor.id, createdByName: actor.name } }).catch(() => {});
      void writeAudit(actor, { action: 'DATA_BACKUP', entityType: 'Backup', entityId: fileName, entityLabel: fileName, description: r.error ? `Full database backup FAILED: ${r.error}` : 'Full database backup (pg_dump) created', ip: clientIp(req), metadata: { kind: 'DB_DUMP' } });
    });
    return new NextResponse(stream, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'The backup could not be started.' }, { status: 500 });
  }
}
