import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateTempPassword, hashPassword, verifyPassword } from '@/lib/auth';
import { guardApi, invalidateAuthUserCache } from '@/lib/api-auth';
import { writeAudit } from '@/lib/audit';
import { clientIp } from '@/lib/auth-rate-limit';

/**
 * A Super Admin resets another person's password. The new password is generated on the server and returned ONCE
 * in this response so it can be handed over; it is not stored in plain text or written to any log.
 * The admin must re-enter their own password first. The user is signed out everywhere.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const adminPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  if (!adminPassword) return NextResponse.json({ error: 'Enter your own password to confirm.' }, { status: 400 });

  const admin = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { passwordHash: true } });
  if (!admin || !verifyPassword(adminPassword, admin.passwordHash)) {
    return NextResponse.json({ error: 'Your password is incorrect.' }, { status: 401 });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.isStation) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const temporaryPassword = generateTempPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(temporaryPassword), sessionVersion: { increment: 1 } } });
  invalidateAuthUserCache(id);
  await writeAudit(auth.user, {
    action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: id, entityLabel: target.email,
    description: `Password for ${target.name} was reset by ${auth.user.name}`, ip: clientIp(req), depotId: target.assignedDepotId,
  });

  return NextResponse.json(
    { success: true, message: `Password for ${target.name} was reset. Give them the temporary password below; it is shown only once.`, temporaryPassword },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
