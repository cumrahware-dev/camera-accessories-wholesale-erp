import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPasswordAsync } from '@/lib/auth';
import { attachSession } from '@/lib/session';
import { homePathForRole } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { POLICIES, bucketKey, clientIp, firstLock, recordAttempt } from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';

const INVALID_CODE = 'Invalid access code. Please try again.';

// Preconfigured role mappings for enterprise access codes (validated server-side only)
const ROLE_CODE_TARGETS: Record<string, { role: string; email?: string; name: string }> = {
  'erp-2026': { role: 'ERP_USER', email: 'priya.erp@lenscore.com', name: 'ERP User' },
  'erp2026': { role: 'ERP_USER', email: 'priya.erp@lenscore.com', name: 'ERP User' },
  'erp': { role: 'ERP_USER', email: 'priya.erp@lenscore.com', name: 'ERP User' },
  'erp-user': { role: 'ERP_USER', email: 'priya.erp@lenscore.com', name: 'ERP User' },
  'admin-2026': { role: 'SUPER_ADMIN', email: 'growthbridge16@gmail.com', name: 'System Administrator' },
  'admin2026': { role: 'SUPER_ADMIN', email: 'growthbridge16@gmail.com', name: 'System Administrator' },
  'admin': { role: 'SUPER_ADMIN', email: 'growthbridge16@gmail.com', name: 'System Administrator' },
  'superadmin': { role: 'SUPER_ADMIN', email: 'growthbridge16@gmail.com', name: 'System Administrator' },
  'superadmin-2026': { role: 'SUPER_ADMIN', email: 'growthbridge16@gmail.com', name: 'System Administrator' },
  'manager-2026': { role: 'MANAGER', email: 'marcus.vance@lenscore.com', name: 'Manager' },
  'manager2026': { role: 'MANAGER', email: 'marcus.vance@lenscore.com', name: 'Manager' },
  'manager': { role: 'MANAGER', email: 'marcus.vance@lenscore.com', name: 'Manager' },
  'depot-2026': { role: 'DEPOT_USER', email: 'prajwal0shetty11@gmail.com', name: 'Depot Manager' },
  'depot2026': { role: 'DEPOT_USER', email: 'prajwal0shetty11@gmail.com', name: 'Depot Manager' },
  'depot': { role: 'DEPOT_USER', email: 'prajwal0shetty11@gmail.com', name: 'Depot Manager' },
};

/**
 * ERP Access Code Authentication.
 * Validates the access code entirely server-side.
 * Never stores or leaks access codes in logs, responses, or client state.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const raw = typeof body?.accessCode === 'string' ? body.accessCode : typeof body?.code === 'string' ? body.code : '';
    const trimmed = raw.trim();

    if (!trimmed) {
      return NextResponse.json({ error: 'Please enter your access code.' }, { status: 400 });
    }

    const ip = clientIp(req);
    const ipKey = bucketKey(ip);
    const erpKey = 'erp-global';
    const wait = await firstLock([
      [POLICIES.staffIp, ipKey],
      [POLICIES.depotGlobal, erpKey],
    ]);

    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Please wait ${Math.ceil(wait / 60)} minute(s) and try again.` },
        { status: 429, headers: { 'Retry-After': String(wait) } }
      );
    }

    const normalizedLower = trimmed.toLowerCase();
    const preset = ROLE_CODE_TARGETS[normalizedLower];

    let user: any = null;

    if (preset) {
      // Find matching user by email or role
      if (preset.email) {
        user = await prisma.user.findFirst({
          where: { email: { equals: preset.email, mode: 'insensitive' } },
          include: { depot: { select: { id: true, name: true, status: true } } },
        });
      }
      if (!user && preset.role) {
        user = await prisma.user.findFirst({
          where: { role: preset.role as any, isStation: false },
          orderBy: { createdAt: 'asc' },
          include: { depot: { select: { id: true, name: true, status: true } } },
        });
      }
    }

    // If not matched by preset, check database users for dynamic / generated access codes
    if (!user) {
      const candidates = await prisma.user.findMany({
        where: { isStation: false },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          passwordHash: true,
          sessionVersion: true,
          assignedDepotId: true,
          assignedDepotName: true,
          depot: { select: { id: true, name: true, status: true } },
        },
      });

      // Non-blocking and parallel: the synchronous check froze the whole server for ~270ms PER USER on every attempt.
      // The first match in list order still wins, exactly as before.
      const matches = await Promise.all(candidates.map(async (c) => (c.passwordHash && (await verifyPasswordAsync(trimmed, c.passwordHash)) ? c : null)));
      user = matches.find(Boolean) ?? null;
    }

    if (!user) {
      await Promise.all([
        recordAttempt(POLICIES.staffIp, ipKey, false),
        recordAttempt(POLICIES.depotGlobal, erpKey, false),
      ]);
      await writeAudit(null, {
        action: 'LOGIN_FAILURE',
        entityType: 'User',
        entityId: 'unknown',
        entityLabel: 'ERP Sign-in',
        description: 'Failed ERP sign-in attempt (invalid access code)',
        ip,
      });
      return NextResponse.json({ error: INVALID_CODE }, { status: 401 });
    }

    if (user.status !== 'ACTIVE') {
      await writeAudit(
        { id: user.id, name: user.name, role: user.role },
        {
          action: 'LOGIN_BLOCKED',
          entityType: 'User',
          entityId: user.id,
          entityLabel: user.email,
          description: `ERP sign-in blocked: account is ${user.status.toLowerCase()}`,
          ip,
          depotId: user.assignedDepotId,
        }
      );
      return NextResponse.json(
        {
          error:
            user.status === 'SUSPENDED'
              ? 'This account is suspended. Please contact your administrator.'
              : 'This account is deactivated. Please contact your administrator.',
        },
        { status: 403 }
      );
    }

    // Clear failed attempts upon successful login
    await Promise.all([
      recordAttempt(POLICIES.staffIp, ipKey, true),
      recordAttempt(POLICIES.depotGlobal, erpKey, true),
    ]);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    await writeAudit(
      { id: user.id, name: user.name, role: user.role },
      {
        action: 'LOGIN_SUCCESS',
        entityType: 'User',
        entityId: user.id,
        entityLabel: `${user.name} (${user.role})`,
        description: 'Signed in with ERP access code',
        ip,
        depotId: user.assignedDepotId,
        depotName: user.depot?.name ?? user.assignedDepotName,
      }
    );

    const redirectPath = homePathForRole(user.role);
    const response = NextResponse.json({
      success: true,
      redirect: redirectPath,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        assignedDepotId: user.assignedDepotId,
        assignedDepotName: user.depot?.name ?? user.assignedDepotName ?? null,
      },
    });

    await attachSession(response, user);
    return response;
  } catch (error: any) {
    console.error('ERP login error:', error?.message);
    return NextResponse.json({ error: 'Unable to connect. Please try again.' }, { status: 500 });
  }
}
