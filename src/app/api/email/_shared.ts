import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/rbac';
import { AppUrlError } from '@/lib/app-url';
import { DOC_PERMISSIONS, EmailError, isDocType, type DocType } from '@/lib/email/document-email';

/** Checks the caller may read or write this kind of document; returns an error response or null. */
export function docAccess(role: string, type: unknown, mode: 'read' | 'write'): { type?: DocType; denied?: NextResponse } {
  if (!isDocType(type)) return { denied: NextResponse.json({ error: 'Unknown document type.' }, { status: 400 }) };
  if (!hasPermission(role, DOC_PERMISSIONS[type][mode])) {
    return { denied: NextResponse.json({ error: 'You do not have permission for this document.' }, { status: 403 }) };
  }
  return { type };
}

export function emailErrorResponse(e: any) {
  if (e instanceof EmailError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
  // A missing public address (APP_BASE_URL) only removes the optional "view online" link; it must never read as a
  // generic failure. Says exactly what to configure, in case any path still depends on it.
  if (e instanceof AppUrlError || e?.name === 'AppUrlError') {
    console.error('[Email API] configuration:', e?.message);
    return NextResponse.json({ error: e.message, code: 'APP_URL_NOT_CONFIGURED' }, { status: 503 });
  }
  console.error('[Email API]', e?.message);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
