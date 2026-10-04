import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { regenerateUserAccessCode, revokeUserAccessCode } from '@/lib/services/user-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action || 'regenerate';

  try {
    if (action === 'revoke') {
      await revokeUserAccessCode(id, auth.user, undefined, clientIp(req));
      return NextResponse.json({ success: true, message: 'Access code revoked.' }, { headers: NO_STORE });
    }

    const accessCode = await regenerateUserAccessCode(id, auth.user, undefined, clientIp(req));
    return NextResponse.json({ success: true, accessCode }, { headers: NO_STORE });
  } catch (e) {
    return serviceError(e, 'user access-code POST');
  }
}
