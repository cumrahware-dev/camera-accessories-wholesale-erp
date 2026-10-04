import { NextResponse } from 'next/server';
import { DepotError } from '@/lib/services/depot-service';
import { UserError } from '@/lib/services/user-service';

/** Maps service errors to JSON responses; anything unexpected becomes a generic 500 (details only in the server log). */
export function serviceError(e: any, label: string) {
  if (e instanceof DepotError || e instanceof UserError) {
    return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
  }
  console.error(`[${label}]`, e?.message);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

/** Responses that carry a one-time secret must never be cached. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
