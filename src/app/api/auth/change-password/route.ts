import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, passwordPolicyError, verifyPassword } from '@/lib/auth';
import { guardApi, invalidateAuthUserCache } from '@/lib/api-auth';
import { attachSession } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';

/** A signed-in user changes their OWN password. Other devices are signed out; this one stays signed in. */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  if (auth.user.isStation) {
    return NextResponse.json({ error: 'The depot login has no password.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = body?.newPassword;
  if (!currentPassword) return NextResponse.json({ error: 'Enter your current password.' }, { status: 400 });
  const policy = passwordPolicyError(newPassword);
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });
  if (newPassword === currentPassword) return NextResponse.json({ error: 'Choose a password different from the current one.' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
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
