import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { guardApi } from '@/lib/api-auth';
import dataStore from '@/lib/data-store';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await guardApi(req, 'users.write');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const currentPassword = body.currentPassword || body.existingPassword;
    const newPassword = body.newPassword || body.password;

    if (!currentPassword) {
      return NextResponse.json({ error: 'Existing password is required to reset password' }, { status: 400 });
    }

    let actingDbUser: any = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { passwordHash: true, email: true },
    }).catch(() => null);
    if (!actingDbUser) {
      actingDbUser = dataStore.getUserById(auth.user.id);
    }
    if (!actingDbUser || !actingDbUser.passwordHash) {
      return NextResponse.json({ error: 'Acting user record not found' }, { status: 404 });
    }

    const isExistingValid = verifyPassword(currentPassword, actingDbUser.passwordHash, actingDbUser.email);
    if (!isExistingValid) {
      return NextResponse.json({ error: 'Existing password is incorrect' }, { status: 401 });
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters long' }, { status: 400 });
    }

    let target: any = await prisma.user.findUnique({ where: { id } }).catch(() => null);
    if (!target) {
      target = dataStore.getUserById(id);
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const newHash = hashPassword(newPassword);

    // Update in DB
    try {
      await prisma.user.update({
        where: { id },
        data: { passwordHash: newHash },
      });
    } catch {
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        newHash,
        id
      ).catch(() => {});
    }

    // Update in dataStore
    dataStore.updateUser(id, { passwordHash: newHash });

    dataStore.addAuditLog({
      action: 'USER_PERMISSION_CHANGE',
      entityType: 'USER',
      entityId: target.id,
      entityLabel: `${target.name} (${target.role})`,
      description: `Password reset by Administrator (${auth.user?.name || 'Admin'})`,
    });

    return NextResponse.json({
      success: true,
      message: `Password for ${target.name} has been reset successfully`,
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: error.message || 'Failed to reset password' }, { status: 500 });
  }
}
