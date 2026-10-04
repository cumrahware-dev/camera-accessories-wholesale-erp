import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { getEmailLog, listDocumentEmails } from '@/lib/email/document-email';
import { docAccess, emailErrorResponse } from '../_shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const view = (r: any) => ({
  id: r.id, documentType: r.documentType, documentId: r.relatedEntityId, documentNumber: r.relatedEntityRef,
  to: r.recipientEmail, cc: r.ccEmails, bcc: r.bccEmails, subject: r.subject, body: r.bodyText, attachmentName: r.attachmentName,
  status: r.status, failureReason: r.failureReason, providerMessageId: r.providerMessageId, retryCount: r.retryCount,
  sentAt: r.sentAt, createdAt: r.createdAt, updatedAt: r.updatedAt, sentByName: r.sentByName,
});

/** ?type=&id= -> email history of a document;  ?logId= -> one email (used to follow a send). */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  try {
    const logId = sp.get('logId');
    if (logId) {
      const row = await getEmailLog(logId);
      const { denied } = docAccess(auth.user.role, row.documentType, 'read');
      if (denied) return denied;
      return NextResponse.json(view(row));
    }
    const { type, denied } = docAccess(auth.user.role, sp.get('type'), 'read');
    if (denied) return denied;
    const rows = await listDocumentEmails(type!, String(sp.get('id') || ''));
    return NextResponse.json(rows.map(view));
  } catch (e) {
    return emailErrorResponse(e);
  }
}
