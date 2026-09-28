import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import { verifyAccessCode, lookupHashForAccessCode, signAuthPayload } from '@/lib/auth';
import dataStore from '@/lib/data-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { accessCode } = body;

    if (!accessCode || !accessCode.trim()) {
      return NextResponse.json({ error: 'Access code is required' }, { status: 400 });
    }

    const lookupHash = lookupHashForAccessCode(accessCode);

    let user: any = null;
    try {
      user = await withDbTimeout(() =>
        prisma.user.findUnique({ where: { accessCodeLookupHash: lookupHash } })
      );
    } catch {}

    if (!user) {
      user = dataStore.getUserByAccessCodeLookupHash(lookupHash);
    }

    // Same generic error whether the code doesn't exist or fails to verify,
    // so a login attempt can't be used to enumerate valid codes.
    if (!user || !verifyAccessCode(accessCode, user.accessCodeHash)) {
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    }

    if (user.role !== 'DEPOT_USER') {
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    }

    if (user.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This account is deactivated. Contact your Super Admin.' }, { status: 403 });
    }

    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: now },
    }).catch(() => {});
    dataStore.updateUser(user.id, { lastLogin: now.toISOString() });

    dataStore.setCurrentUser(user.id);
    dataStore.addAuditLog({
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      entityLabel: `${user.name} (${user.role})`,
      description: 'Depot user authenticated via access code',
    });

    const token = await signAuthPayload({
      userId: user.id,
      email: user.email,
      role: user.role,
      assignedDepotId: user.assignedDepotId || null,
      timestamp: Date.now(),
    });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      assignedDepotId: user.assignedDepotId,
      assignedDepotName: user.assignedDepotName,
      avatar: user.avatar,
      status: user.status,
    };

    const response = NextResponse.json({
      success: true,
      message: 'Logged in successfully',
      user: safeUser,
      token,
    });

    response.cookies.set('erp_auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days — same session lifetime as password login
    });

    return response;
  } catch (error: any) {
    console.error('Access code login error:', error);
    return NextResponse.json({ error: error.message || 'Login failed' }, { status: 500 });
  }
}
