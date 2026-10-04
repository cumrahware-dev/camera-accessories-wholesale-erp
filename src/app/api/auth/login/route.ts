import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth';
import { attachSession } from '@/lib/session';
import { isDepotRole } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { POLICIES, bucketKey, clientIp, firstLock, recordAttempt } from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';

const BAD_CREDENTIALS = 'Invalid email or password.';
// Compared against when the account does not exist, so a wrong e-mail and a wrong password take the same time.
const DUMMY_HASH = hashPassword('not-a-real-password');

/** Staff sign-in (Super Admin, Manager, ERP, depot staff with their own account): e-mail + password. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password || email.length > 200 || password.length > 200) {
      return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
    }

    const ip = clientIp(req);
    const ipKey = bucketKey(ip);
    const emailKey = bucketKey(email);
    const wait = await firstLock([[POLICIES.staffIp, ipKey], [POLICIES.staffEmail, emailKey]]);
    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Please wait ${Math.ceil(wait / 60)} minute(s) and try again.` },
        { status: 429, headers: { 'Retry-After': String(wait) } }
      );
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { depot: { select: { id: true, name: true, status: true } } },
    });

    const valid = verifyPassword(password, user && !user.isStation ? user.passwordHash : DUMMY_HASH) && !!user && !user.isStation;
    if (!valid || !user) {
      await Promise.all([recordAttempt(POLICIES.staffIp, ipKey, false), recordAttempt(POLICIES.staffEmail, emailKey, false)]);
      await writeAudit(user ? { id: user.id, name: user.name, role: user.role } : null, {
        action: 'LOGIN_FAILURE', entityType: 'User', entityId: user?.id || 'unknown', entityLabel: email,
        description: 'Failed sign-in attempt (wrong email or password)', ip, depotId: user?.assignedDepotId,
      });
      return NextResponse.json({ error: BAD_CREDENTIALS }, { status: 401 });
    }

    // The password is correct from here on, so it is safe to explain why the account cannot be used.
    if (user.status !== 'ACTIVE') {
      await writeAudit({ id: user.id, name: user.name, role: user.role }, {
        action: 'LOGIN_BLOCKED', entityType: 'User', entityId: user.id, entityLabel: user.email,
        description: `Sign-in blocked: account is ${user.status.toLowerCase()}`, ip, depotId: user.assignedDepotId,
      });
      return NextResponse.json(
        { error: user.status === 'SUSPENDED' ? 'This account is suspended. Please contact your administrator.' : 'This account is deactivated. Please contact your administrator.' },
        { status: 403 }
      );
    }
    if (isDepotRole(user.role) && user.assignedDepotId && user.depot?.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'This depot is currently inactive. Please contact the administrator.' }, { status: 403 });
    }

    await Promise.all([recordAttempt(POLICIES.staffIp, ipKey, true), recordAttempt(POLICIES.staffEmail, emailKey, true)]);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), ...(needsRehash(user.passwordHash) ? { passwordHash: hashPassword(password) } : {}) },
    });
    await writeAudit({ id: user.id, name: user.name, role: user.role }, {
      action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id, entityLabel: `${user.name} (${user.role})`,
      description: 'Signed in with email and password', ip, depotId: user.assignedDepotId, depotName: user.depot?.name,
    });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, assignedDepotId: user.assignedDepotId, assignedDepotName: user.depot?.name ?? null },
    });
    await attachSession(response, user);
    return response;
  } catch (error: any) {
    console.error('Login error:', error?.message);
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, { status: 500 });
  }
}
