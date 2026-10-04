import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { parsePagination } from '@/lib/pagination';
import { clientIp } from '@/lib/auth-rate-limit';
import { createUser, listUsers } from '@/lib/services/user-service';
import { NO_STORE, serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'users.read');
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const { take, skip } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { users, total } = await listUsers({
      q: sp.get('q')?.trim() || undefined, role: sp.get('role') || undefined, depotId: sp.get('depotId') || undefined,
      status: sp.get('status') || undefined, take, skip,
    });
    return NextResponse.json(users, { headers: { 'X-Total-Count': String(total) } });
  } catch (e) {
    return serviceError(e, 'users GET');
  }
}

/**
 * Creates a user. If no password is supplied the server generates one and returns it ONCE in `temporaryPassword`.
 * Only the listed fields are accepted: the request body is never spread into the database write.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    const { user, temporaryPassword } = await createUser(
      { name: body.name, email: body.email, phone: body.phone, role: body.role, depotId: body.depotId ?? body.assignedDepotId, status: body.status, password: body.password, permissionRevokes: body.permissionRevokes },
      auth.user, undefined, clientIp(req)
    );
    return NextResponse.json({ ...user, temporaryPassword }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return serviceError(e, 'users POST');
  }
}
