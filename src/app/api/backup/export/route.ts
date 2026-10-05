import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';
import { jsonExportStream, workbookSheets } from '@/lib/backup/app-export';
import { toXlsx } from '@/lib/exports/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Application Data Export (selected business records, credentials removed). Super Admin only.
 * POST (it records a history row): { format: 'json' | 'xlsx' }. The file is streamed to the caller and is NOT kept on the server.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const format = body?.format === 'xlsx' ? 'xlsx' : body?.format === 'json' || body?.format === undefined ? 'json' : null;
  if (!format) return NextResponse.json({ error: 'format must be json or xlsx.' }, { status: 400 });

  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const fileName = `ARIB_GLOBAL_data_export_${stamp}.${format}`;
  const record = async (status: 'COMPLETED' | 'FAILED', sizeBytes: number, rowCounts: Record<string, number>, note = '') => {
    await prisma.backupRun.create({ data: { kind: 'APP_EXPORT', status, fileName, sizeBytes: Math.min(sizeBytes, 2_000_000_000), rowCounts, note, createdById: actor.id, createdByName: actor.name } }).catch(() => {});
    await writeAudit(actor, {
      action: 'DATA_BACKUP', entityType: 'Backup', entityId: fileName, entityLabel: fileName,
      description: status === 'COMPLETED' ? `Application data export created (${format.toUpperCase()}, ${Object.values(rowCounts).reduce((a, b) => a + b, 0)} rows)` : `Application data export FAILED: ${note}`,
      ip: clientIp(req), metadata: { format, status },
    });
  };

  try {
    if (format === 'xlsx') {
      const { sheets, rowCounts } = await workbookSheets();
      const buffer = toXlsx(sheets.map((s) => ({ name: s.name, head: s.head, rows: s.rows })));
      await record('COMPLETED', buffer.length, rowCounts);
      return new NextResponse(new Uint8Array(buffer), {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const stream = jsonExportStream((r) => { void record(r.error ? 'FAILED' : 'COMPLETED', r.bytes, r.rowCounts, r.error || ''); });
    return new NextResponse(stream, {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (e: any) {
    await record('FAILED', 0, {}, e?.message || 'failed');
    return NextResponse.json({ error: e?.message || 'The export failed. Nothing was changed.' }, { status: 500 });
  }
}
