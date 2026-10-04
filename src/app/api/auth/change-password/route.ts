import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, passwordPolicyError, verifyPasswordAsync } from '@/lib/auth';
import { guardApi, invalidateAuthUserCache } from '@/lib/api-auth';
import { attachSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';

/**
 * A signed-in user changes their OWN password directly: the signed-in session is enough, the current
 * password is not asked for. Other devices are signed out; this one stays signed in.
 */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  if (auth.user.isStation) {
    return NextResponse.json({ error: 'The depot login has no password.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const newPassword = body?.newPassword;
  const policy = passwordPolicyError(newPassword);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (await verifyPasswordAsync(newPassword, user.passwordHash)) {
    return NextResponse.json({ error: 'Choose a password different from the current one.' }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), sessionVersion: { increment: 1 } },
  });
  invalidateAuthUserCache(user.id);
  await writeAudit({ id: user.id, name: user.name, role: user.role }, {
    action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id, entityLabel: user.email,
    description: 'User changed their own password', ip: clientIp(req), depotId: user.assignedDepotId,
  });

  const response = NextResponse.json({ success: true, message: 'Your password has been changed.' });
  await attachSession(response, updated);
  return response;
}
