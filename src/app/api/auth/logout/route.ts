import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, invalidateAuthUserCache } from '@/lib/api-auth';
import { clearSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req).catch(() => null);
  if (user) {
    invalidateAuthUserCache(user.id);
    await writeAudit(user, {
      action: user.isStation ? 'DEPOT_LOGOUT' : 'LOGOUT', entityType: user.isStation ? 'Depot' : 'User',
      entityId: user.isStation ? user.assignedDepotId || user.id : user.id, entityLabel: user.isStation ? user.name : user.email,
      description: 'Signed out', ip: clientIp(req), depotId: user.assignedDepotId, depotName: user.assignedDepotName,
    });
  }
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  clearSession(response);
  return response;
}
