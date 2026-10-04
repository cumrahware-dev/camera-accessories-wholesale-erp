import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { queueEmail } from '@/lib/email/document-email';
import { docAccess, emailErrorResponse } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * Queues a document email and returns immediately (202). The email worker sends it in the background;
 * poll GET /api/email/logs?logId=... for SENT / FAILED. This response never claims the email was sent.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const { type, denied } = docAccess(auth.user.role, body.documentType, 'write');
  if (denied) return denied;
  try {
    const row = await queueEmail(
      { type: type!, id: String(body.documentId || ''), to: body.to, cc: body.cc, bcc: body.bcc, subject: body.subject, body: body.body },
      { id: auth.user.id, name: auth.user.name, role: auth.user.role },
      hasPermission(auth.user.role, 'emails.override')
    );
    return NextResponse.json({ logId: row.id, status: row.status }, { status: 202 });
  } catch (e) {
    return emailErrorResponse(e);
  }
}
