import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import { verifyPassword, hashPassword, signAuthPayload, DEFAULT_USER_CREDENTIALS } from '@/lib/auth';
import dataStore from '@/lib/data-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Find user in database with passwordHash
    const rawUsers = await withDbTimeout(() =>
      prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name, email, avatar, role, "assignedDepotId", "assignedDepotName", phone, status, "passwordHash" FROM "User" WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        cleanEmail
      )
    ).catch(() => []);

    let user = rawUsers.length > 0 ? rawUsers[0] : null;

    // Fallback search in dataStore or default credentials matrix if not yet in database
    if (!user) {
      const mockUser = dataStore.getUsers().find((u) => u.email.toLowerCase() === cleanEmail);
      const defaultCred = DEFAULT_USER_CREDENTIALS[cleanEmail];
      if (mockUser || defaultCred) {
        // Automatically create in database
        try {
          const defaultRole = mockUser?.role || defaultCred?.role || 'SUPER_ADMIN';
          const defaultName = mockUser?.name || cleanEmail.split('@')[0];
          user = await prisma.user.create({
            data: {
              id: mockUser?.id || `usr-${Date.now()}`,
              name: defaultName,
              email: cleanEmail,
              role: defaultRole as any,
              assignedDepotId: mockUser?.assignedDepotId || null,
              assignedDepotName: mockUser?.assignedDepotName || null,
              avatar: mockUser?.avatar || '',
              phone: mockUser?.phone || '',
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
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (user.status === 'INACTIVE') {
      return NextResponse.json({ error: 'Account is deactivated. Contact your Super Admin.' }, { status: 403 });
    }

    // 2. Resolve password hash and verify
    const passwordHash = user.passwordHash || dataStore.getUserById(user.id)?.passwordHash;

    const isPasswordValid = verifyPassword(password, passwordHash, user.email);

    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Auto-upgrade password hash in DB & dataStore if empty or plain-text (missing salt:hash separator)
    if (user.id && (!user.passwordHash || !user.passwordHash.includes(':'))) {
      const newHash = hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      }).catch(() => {});
      dataStore.updateUser(user.id, { passwordHash: newHash });
    }

    // 3. Update last login timestamp in DB and dataStore
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
      description: `User authenticated successfully (${user.role})`,
    });

    // 4. Generate Auth Token
    const token = await signAuthPayload({
      userId: user.id,
      email: user.email,
      role: user.role,
      assignedDepotId: user.assignedDepotId || null,
      timestamp: Date.now(),
    });

    // 5. Response with user info and secure HTTP cookie
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
