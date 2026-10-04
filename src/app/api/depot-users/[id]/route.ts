import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { clientIp } from '@/lib/auth-rate-limit';
import { depotScopeOf, resetUserPassword, updateUser } from '@/lib/services/user-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Depot Manager edits a member of their own depot (name, phone, staff role, status). Other depots resolve to 404. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'depot_users.manage');
  if (!auth.ok) return auth.response;
  const scope = depotScopeOf(auth.user);
  if (!scope) return NextResponse.json({ error: 'Your account is not assigned to a depot.' }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    return NextResponse.json(await updateUser(id, { name: body.name, phone: body.phone, role: body.role, status: body.status }, auth.user, scope, clientIp(req)));
  } catch (e) {
    return serviceError(e, 'depot-users PATCH');
  }
}

/** POST = reset this staff member's password; the temporary password is returned once. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'depot_users.manage');
  if (!auth.ok) return auth.response;
  const scope = depotScopeOf(auth.user);
  if (!scope) return NextResponse.json({ error: 'Your account is not assigned to a depot.' }, { status: 403 });
  const { id } = await params;
  try {
    const temporaryPassword = await resetUserPassword(id, auth.user, scope, clientIp(req));
    return NextResponse.json({ success: true, temporaryPassword }, { headers: NO_STORE });
  } catch (e) {
    return serviceError(e, 'depot-users reset');
  }
}
