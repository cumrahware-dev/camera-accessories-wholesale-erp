import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';
import { clientIp } from '@/lib/auth-rate-limit';
import { createUser, depotScopeOf, listUsers } from '@/lib/services/user-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

/** Depot Manager: the staff of MY depot. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'depot_users.manage');
  if (!auth.ok) return auth.response;
  const scope = depotScopeOf(auth.user);
  if (!scope) return NextResponse.json({ error: 'Your account is not assigned to a depot.' }, { status: 403 });
  try {
    const { take, skip } = parsePagination(req, { defaultLimit: 100, maxLimit: 200 });
    const { users } = await listUsers({ take, skip }, scope);
    return NextResponse.json(users);
  } catch (e) {
    return serviceError(e, 'depot-users GET');
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'depot_users.manage');
  if (!auth.ok) return auth.response;
  const scope = depotScopeOf(auth.user);
  if (!scope) return NextResponse.json({ error: 'Your account is not assigned to a depot.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    const { user, temporaryPassword } = await createUser(
      { name: body.name, email: body.email, phone: body.phone, role: body.role, status: body.status },
      auth.user, scope, clientIp(req)
    );
    return NextResponse.json({ ...user, temporaryPassword }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return serviceError(e, 'depot-users POST');
  }
}
