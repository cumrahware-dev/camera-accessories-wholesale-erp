import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { regenerateAccessCode, revokeAccessCode } from '@/lib/services/depot-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

/**
 * Super Admin only.
 *   { action: 'regenerate' } -> new code, returned in THIS response only; the old code stops working immediately
 *   { action: 'revoke' }     -> the depot can no longer sign in until a new code is generated
 * There is deliberately no way to read an existing code: only a hash of it is stored.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'depots.access_code');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === 'regenerate') {
      const { depot, accessCode } = await regenerateAccessCode(id, auth.user, clientIp(req));
      return NextResponse.json({ depot, accessCode }, { headers: NO_STORE });
    }
    if (body?.action === 'revoke') {
      return NextResponse.json({ depot: await revokeAccessCode(id, auth.user, clientIp(req)) }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "action must be 'regenerate' or 'revoke'." }, { status: 400 });
  } catch (e) {
    return serviceError(e, 'depot access-code');
  }
}
