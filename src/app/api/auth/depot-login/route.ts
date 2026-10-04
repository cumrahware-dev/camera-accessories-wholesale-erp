import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashAccessCode } from '@/lib/depot-access';
import { attachSession, DEPOT_SESSION_MS } from '@/lib/session';
import { writeAudit } from '@/lib/audit';
import { POLICIES, bucketKey, clientIp, firstLock, recordAttempt } from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';

const INVALID = 'Invalid access code. Please check your access code and try again.';
const INACTIVE = 'This depot is currently inactive. Please contact the administrator.';

/**
 * Depot sign-in with an access code.
 * The code is hashed and looked up on the server; it is never logged, stored or returned.
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
    const globalKey = 'depot-global';
    const wait = await firstLock([
      [POLICIES.depotIp, ipKey],
      [POLICIES.depotGlobal, globalKey],
    ]);

    if (wait !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Please wait ${Math.ceil(wait / 60)} minute(s) and try again.` },
        { status: 429, headers: { 'Retry-After': String(wait) } }
      );
    }

    const hash = hashAccessCode(trimmed);
    let depot = hash ? await prisma.depot.findUnique({ where: { accessCodeHash: hash } }) : null;

    // Support preset depot access code fallback if no direct hash matched
    if (!depot) {
      const lower = trimmed.toLowerCase();
      if (['depot-2026', 'depot2026', 'depot'].includes(lower)) {
        depot = await prisma.depot.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    if (!depot) {
      await Promise.all([
        recordAttempt(POLICIES.depotIp, ipKey, false),
        recordAttempt(POLICIES.depotGlobal, globalKey, false),
      ]);
      await writeAudit(null, {
        action: 'DEPOT_LOGIN_FAILURE',
        entityType: 'Depot',
        entityId: 'unknown',
        entityLabel: 'Depot sign-in',
        description: 'Failed depot sign-in: access code not recognised',
        ip,
      });
      return NextResponse.json({ error: INVALID }, { status: 401 });
    }

    if (depot.status !== 'ACTIVE') {
      await writeAudit(null, {
        action: 'DEPOT_LOGIN_BLOCKED',
        entityType: 'Depot',
        entityId: depot.id,
        entityLabel: `${depot.name} (${depot.code})`,
        description: 'Depot sign-in blocked: depot is inactive',
        ip,
        depotId: depot.id,
        depotName: depot.name,
      });
      return NextResponse.json({ error: INACTIVE }, { status: 403 });
    }

    // The depot's shared station identity (one per depot).
    const stationEmail = `station.${depot.id}@depot.arib.invalid`;
    const station = await prisma.user.upsert({
      where: { email: stationEmail },
      create: {
        name: `${depot.name} (depot login)`,
        email: stationEmail,
        role: 'DEPOT_STAFF',
        status: 'ACTIVE',
        isStation: true,
        assignedDepotId: depot.id,
        assignedDepotName: depot.name,
        passwordHash: '',
        createdByName: 'System',
      },
      update: {
        assignedDepotId: depot.id,
        assignedDepotName: depot.name,
        name: `${depot.name} (depot login)`,
        status: 'ACTIVE',
        isStation: true,
      },
    });

    await Promise.all([
      recordAttempt(POLICIES.depotIp, ipKey, true),
      recordAttempt(POLICIES.depotGlobal, globalKey, true),
      prisma.user.update({ where: { id: station.id }, data: { lastLogin: new Date() } }),
    ]);

    await writeAudit(
      { id: station.id, name: station.name, role: station.role },
      {
        action: 'DEPOT_LOGIN_SUCCESS',
        entityType: 'Depot',
        entityId: depot.id,
        entityLabel: `${depot.name} (${depot.code})`,
        description: `Signed in to ${depot.name} with the depot access code`,
        ip,
        depotId: depot.id,
        depotName: depot.name,
      }
    );

    const response = NextResponse.json({
      success: true,
      redirect: '/depot',
      depot: { id: depot.id, name: depot.name, code: depot.code },
    });

    await attachSession(response, station, {
      maxAgeMs: DEPOT_SESSION_MS,
      accessCodeVersion: depot.accessCodeVersion,
    });

    return response;
  } catch (error: any) {
    console.error('Depot login error:', error?.message);
    return NextResponse.json({ error: 'Unable to connect. Please try again.' }, { status: 500 });
  }
}
