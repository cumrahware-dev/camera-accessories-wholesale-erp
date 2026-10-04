/**
 * Creates the signed session cookie. The token is only ever sent as an HttpOnly cookie, never in a response body,
 * so page scripts (and anything injected into them) cannot read it.
 */
import 'server-only';
import type { NextResponse } from 'next/server';
import { signAuthPayload } from '@/lib/auth-token';

export const COOKIE_NAME = 'erp_auth_token';
export const STAFF_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
/** Depot stations are shared devices on a warehouse floor: sign them out after a working day. */
export const DEPOT_SESSION_MS = 12 * 60 * 60 * 1000;

export async function attachSession(
  response: NextResponse,
  user: { id: string; email: string; role: string; assignedDepotId?: string | null; sessionVersion: number },
  opts: { maxAgeMs?: number; accessCodeVersion?: number } = {}
) {
  const maxAgeMs = opts.maxAgeMs ?? STAFF_SESSION_MS;
  const now = Date.now();
  const token = await signAuthPayload({
    userId: user.id,
    email: user.email,
    role: user.role,
    assignedDepotId: user.assignedDepotId ?? null,
    sv: user.sessionVersion,
    ...(opts.accessCodeVersion !== undefined ? { av: opts.accessCodeVersion } : {}),
    exp: now + maxAgeMs,
    timestamp: now,
  });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export function clearSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, expires: new Date(0), path: '/' });
}
