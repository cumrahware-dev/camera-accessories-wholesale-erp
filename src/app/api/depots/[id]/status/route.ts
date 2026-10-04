import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { setDepotStatus } from '@/lib/services/depot-service';
import { serviceError } from '@/lib/services/http';

/** { status: 'ACTIVE' | 'INACTIVE' }. Deactivating blocks the depot's sign-in and ends its sessions; no data is deleted. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guardApi(req, 'depots.disable');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (body?.status !== 'ACTIVE' && body?.status !== 'INACTIVE') {
    return NextResponse.json({ error: 'status must be ACTIVE or INACTIVE.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await setDepotStatus(id, body.status, auth.user, clientIp(req)));
  } catch (e) {
    return serviceError(e, 'depot status');
  }
}
