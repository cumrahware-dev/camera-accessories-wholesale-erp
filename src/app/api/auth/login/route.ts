import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import { verifyPassword, hashPassword, signAuthPayload, DEFAULT_USER_CREDENTIALS } from '@/lib/auth';
import dataStore from '@/lib/data-store';

// Access Code mapping for fast login without email
const ACCESS_CODES: Record<string, { role: string; defaultEmail: string; name: string }> = {
  // ERP User Access Codes
  'erp-2026': { role: 'ERP_USER', defaultEmail: 'erp@aribglobal.com', name: 'ERP' },
  'erp2026': { role: 'ERP_USER', defaultEmail: 'erp@aribglobal.com', name: 'ERP' },
  'erp': { role: 'ERP_USER', defaultEmail: 'erp@aribglobal.com', name: 'ERP' },
  'erp-user': { role: 'ERP_USER', defaultEmail: 'erp@aribglobal.com', name: 'ERP' },
  'erpuser': { role: 'ERP_USER', defaultEmail: 'erp@aribglobal.com', name: 'ERP' },

  // Depot User Access Codes
  'depot-2026': { role: 'DEPOT_USER', defaultEmail: 'depot@aribglobal.com', name: 'Depot' },
  'depot2026': { role: 'DEPOT_USER', defaultEmail: 'depot@aribglobal.com', name: 'Depot' },
  'depot': { role: 'DEPOT_USER', defaultEmail: 'depot@aribglobal.com', name: 'Depot' },
  'depot-user': { role: 'DEPOT_USER', defaultEmail: 'depot@aribglobal.com', name: 'Depot' },
  'depotuser': { role: 'DEPOT_USER', defaultEmail: 'depot@aribglobal.com', name: 'Depot' },

  // Super Admin Access Codes
  'admin-2026': { role: 'SUPER_ADMIN', defaultEmail: 'admin@aribglobal.com', name: 'Administrator' },
  'admin2026': { role: 'SUPER_ADMIN', defaultEmail: 'admin@aribglobal.com', name: 'Administrator' },
  'admin': { role: 'SUPER_ADMIN', defaultEmail: 'admin@aribglobal.com', name: 'Administrator' },
  'superadmin': { role: 'SUPER_ADMIN', defaultEmail: 'admin@aribglobal.com', name: 'Administrator' },

  // Manager Access Codes
  'manager-2026': { role: 'MANAGER', defaultEmail: 'manager@aribglobal.com', name: 'Manager' },
  'manager2026': { role: 'MANAGER', defaultEmail: 'manager@aribglobal.com', name: 'Manager' },
  'manager': { role: 'MANAGER', defaultEmail: 'manager@aribglobal.com', name: 'Manager' },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputVal = (body.accessCode || body.code || body.email || '').trim();
    const password = body.password || '';

    if (!inputVal) {
      return NextResponse.json({ error: 'Access code or credential is required' }, { status: 400 });
    }

    const normalizedInput = inputVal.toLowerCase();
    const accessCodeMatch = ACCESS_CODES[normalizedInput];

    let user: any = null;

    if (accessCodeMatch) {
      // 1. Logging in via Access Code! Find DB user by role or email
      const targetRole = accessCodeMatch.role;
      const targetEmail = accessCodeMatch.defaultEmail;

      const rawUsers = await withDbTimeout(() =>
        prisma.$queryRawUnsafe<any[]>(
          `SELECT id, name, email, avatar, role, "assignedDepotId", "assignedDepotName", phone, status, "passwordHash" 
           FROM "User" 
           WHERE LOWER(email) = LOWER($1) OR role::text = $2 
           ORDER BY "createdAt" ASC LIMIT 1`,
          targetEmail,
          targetRole
        )
      ).catch(() => []);

      user = rawUsers.length > 0 ? rawUsers[0] : null;

      if (!user) {
        // Create fallback user in database if missing
        try {
          user = await prisma.user.create({
            data: {
              id: `usr-${targetRole.toLowerCase()}-${Date.now()}`,
              name: accessCodeMatch.name,
              email: targetEmail,
              role: targetRole as any,
              status: 'ACTIVE',
              passwordHash: hashPassword(password || 'Arib2026!'),
            },
          });
        } catch {
          user = {
            id: `usr-${targetRole.toLowerCase()}`,
            name: accessCodeMatch.name,
            email: targetEmail,
            role: targetRole,
            status: 'ACTIVE',
          };
        }
      } else {
        // Update DB name and in-memory name if it was a legacy name
        if (user.name !== accessCodeMatch.name) {
          user.name = accessCodeMatch.name;
          prisma.user.update({
            where: { id: user.id },
            data: { name: accessCodeMatch.name }
          }).catch(() => {});
        }
      }
    } else {
      // 2. Logging in via standard email/username
      const cleanEmail = normalizedInput;

      const rawUsers = await withDbTimeout(() =>
        prisma.$queryRawUnsafe<any[]>(
          `SELECT id, name, email, avatar, role, "assignedDepotId", "assignedDepotName", phone, status, "passwordHash" 
           FROM "User" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          cleanEmail
        )
      ).catch(() => []);

      user = rawUsers.length > 0 ? rawUsers[0] : null;

      // Fallback search in dataStore or default credentials
      if (!user) {
        const mockUser = dataStore.getUsers().find((u) => u.email.toLowerCase() === cleanEmail);
        const defaultCred = DEFAULT_USER_CREDENTIALS[cleanEmail];
        if (mockUser || defaultCred) {
          try {
            const defaultRole = mockUser?.role || defaultCred?.role || 'SUPER_ADMIN';
            const defaultName = mockUser?.name || cleanEmail.split('@')[0];
            user = await prisma.user.create({
              data: {
                id: mockUser?.id || `usr-${Date.now()}`,
                name: defaultName,
                email: cleanEmail,
                role: defaultRole as any,
                status: 'ACTIVE',
                passwordHash: hashPassword(password),
              },
            });
          } catch {
            user = mockUser || {
              id: `usr-${Date.now()}`,
              name: cleanEmail.split('@')[0],
              email: cleanEmail,
              role: defaultCred?.role || 'SUPER_ADMIN',
              status: 'ACTIVE',
              passwordHash: hashPassword(password),
            };
          }
        }
      }

      if (!user) {
        return NextResponse.json({ error: 'Invalid access code or email' }, { status: 401 });
      }

      // Password verification for standard email login
      if (password) {
        const passwordHash = user.passwordHash || dataStore.getUserById(user.id)?.passwordHash;
        const isPasswordValid = verifyPassword(password, passwordHash, user.email);
        if (!isPasswordValid) {
          return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
        }
      }
    }

    if (user.status === 'INACTIVE') {
      return NextResponse.json({ error: 'Account is deactivated. Contact your Super Admin.' }, { status: 403 });
    }

    // Update last login timestamp in DB
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: now },
    }).catch(() => {});

    dataStore.setCurrentUser(user.id);
    dataStore.addAuditLog({
      action: 'LOGIN',
      entityType: 'USER',
      entityId: user.id,
      entityLabel: `${user.name} (${user.role})`,
      description: `User authenticated successfully via access code/credentials (${user.role})`,
    });

    // Generate Auth Token
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
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: error.message || 'Login failed' }, { status: 500 });
  }
}
