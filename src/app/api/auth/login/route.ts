import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import { verifyPassword, signAuthPayload } from '@/lib/auth';
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

    // Fallback search in dataStore if not yet in database
    if (!user && process.env.NODE_ENV !== 'production') {
      const mockUser = dataStore.getUsers().find((u) => u.email.toLowerCase() === cleanEmail);
      if (mockUser) {
        // Automatically create in database
        try {
          user = await prisma.user.create({
            data: {
              id: mockUser.id,
              name: mockUser.name,
              email: mockUser.email,
              role: mockUser.role as any,
              assignedDepotId: mockUser.assignedDepotId,
              assignedDepotName: mockUser.assignedDepotName,
              avatar: mockUser.avatar,
              phone: mockUser.phone,
              status: mockUser.status as any,
            },
          });
        } catch {
          user = mockUser;
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
    const passwordHash = user.passwordHash || (process.env.NODE_ENV !== 'production' ? dataStore.getUserById(user.id)?.passwordHash : undefined);

    const isPasswordValid = verifyPassword(password, passwordHash, user.email);

    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
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
