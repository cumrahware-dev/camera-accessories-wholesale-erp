import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/rbac';
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
  console.error('[Email API]', e?.message);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
