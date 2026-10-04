import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertDepotAccess, guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { clientIp } from '@/lib/auth-rate-limit';
import { depotStats, depotView, updateDepot } from '@/lib/services/depot-service';
import { serviceError } from '@/lib/services/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'depots.read');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const denied = assertDepotAccess(auth.user, id);
  if (denied) return denied;
  try {
    const depot = await prisma.depot.findUnique({ where: { id } });
    if (!depot) return NextResponse.json({ error: 'Depot not found.' }, { status: 404 });
    const s = (await depotStats([id]))[id];
    const canManage = hasPermission(auth.user.role, 'depots.write', auth.user.permissionRevokes);
    const view = depotView(depot);
    // Access-code state is admin information.
    if (!canManage) { delete (view as any).hasAccessCode; delete (view as any).accessCodeRotatedAt; delete (view as any).accessCodeRevokedAt; }
    return NextResponse.json({ ...view, stats: s });
  } catch (e) {
    return serviceError(e, 'depot GET');
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await guardApi(req, 'depots.write');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  try {
    return NextResponse.json(await updateDepot(id, body, auth.user, clientIp(req)));
  } catch (e) {
    return serviceError(e, 'depot PATCH');
  }
}

export const PUT = PATCH;
