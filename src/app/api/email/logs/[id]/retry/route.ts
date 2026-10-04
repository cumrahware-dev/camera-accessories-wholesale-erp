import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { getEmailLog, retryEmail } from '@/lib/email/document-email';
import { docAccess, emailErrorResponse } from '../../../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Retries a FAILED email (same log row). Only the email is retried: no document or number is created. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const row = await getEmailLog(id);
    const { denied } = docAccess(auth.user.role, row.documentType, 'write');
    if (denied) return denied;
    const updated = await retryEmail(id, { id: auth.user.id, name: auth.user.name, role: auth.user.role });
    return NextResponse.json({ logId: updated.id, status: updated.status }, { status: 202 });
  } catch (e) {
    return emailErrorResponse(e);
  }
}
