import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { prepareEmail } from '@/lib/email/document-email';
import { docAccess, emailErrorResponse } from '../_shared';

export const dynamic = 'force-dynamic';

/** Email preview: recipient, rendered template, attachment name. Nothing is sent or saved. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  const { type, denied } = docAccess(auth.user.role, sp.get('type'), 'write');
  if (denied) return denied;
  try {
    const prepared = await prepareEmail(type!, String(sp.get('id') || ''));
    return NextResponse.json({ ...prepared, canOverride: hasPermission(auth.user.role, 'emails.override') });
  } catch (e) {
    return emailErrorResponse(e);
  }
}
