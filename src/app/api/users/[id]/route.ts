import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { clientIp } from '@/lib/auth-rate-limit';
import { getUser, updateUser, userView } from '@/lib/services/user-service';
import { serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'users.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const user = await getUser(id);
    const activity = await prisma.auditLog.findMany({
      where: { userId: id },
      select: { id: true, timestamp: true, action: true, description: true, entityType: true, entityLabel: true },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
    return NextResponse.json({ ...userView(user), activity });
  } catch (e) {
    return serviceError(e, 'user GET');
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    // Disabling needs its own permission so it can be handed out separately from editing.
    if (body.status !== undefined && body.status !== 'ACTIVE' && !hasPermission(auth.user.role, 'users.disable', auth.user.permissionRevokes)) {
      return NextResponse.json({ error: 'Forbidden: you cannot disable users.' }, { status: 403 });
    }
    return NextResponse.json(await updateUser(
      id,
      { name: body.name, email: body.email, phone: body.phone, role: body.role, depotId: body.depotId ?? body.assignedDepotId, status: body.status, permissionRevokes: body.permissionRevokes },
      auth.user, undefined, clientIp(req)
    ));
  } catch (e) {
    return serviceError(e, 'user PATCH');
  }
}

export const PUT = PATCH;

/** Users are never deleted: their audit trail and the records they created must stay. Disable the account instead. */
export async function DELETE(req: NextRequest) {
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { error: 'Users cannot be deleted because their history must be kept. Disable the account instead.' },
    { status: 405, headers: { Allow: 'GET, PATCH' } }
  );
}
