import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { verifyAuthPayload } from '@/lib/auth-token';
import {
  AuthSession,
  Permission,
  canAccessApi,
  canViewCosts,
  hasPermission,
  isDepotScoped,
  isUserRole,
} from '@/lib/rbac';

export type AuthUser = AuthSession & {
  id: string;
  name: string;
  assignedDepotName?: string | null;
  avatar?: string | null;
  phone?: string | null;
  status: string;
};

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  assignedDepotId?: string | null;
  assignedDepotName?: string | null;
  avatar?: string | null;
  phone?: string | null;
  status: string;
}): AuthUser | null {
  if (!isUserRole(user.role)) return null;
  return {
    id: user.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    assignedDepotId: user.assignedDepotId,
    assignedDepotName: user.assignedDepotName,
    avatar: user.avatar,
    phone: user.phone,
    status: user.status,
  };
}

export function publicUserView(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    assignedDepotId: user.assignedDepotId,
    assignedDepotName: user.assignedDepotName,
    avatar: user.avatar,
    phone: user.phone,
    status: user.status,
  };
}

// In-memory cache for validated sessions to eliminate duplicate DB roundtrips across concurrent API requests
const authUserCache = new Map<string, { user: AuthUser; expiresAt: number }>();
const AUTH_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export function invalidateAuthUserCache(userId?: string) {
  if (userId) {
    authUserCache.delete(userId);
  } else {
    authUserCache.clear();
  }
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.cookies.get('erp_auth_token')?.value;
  const decoded = await verifyAuthPayload(token);
  if (!decoded?.userId) return null;

  const now = Date.now();
  const cached = authUserCache.get(decoded.userId);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  let user: any = null;
  try {
    user = await withDbTimeout(() =>
      prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          assignedDepotId: true,
          assignedDepotName: true,
          avatar: true,
          phone: true,
          status: true,
        },
      })
    );
  } catch (err) {
    // DB offline or timed out — fall back to dataStore instantly
    user = dataStore.getUserById(decoded.userId);
  }

  if (!user || user.status !== 'ACTIVE') return null;
  const authUser = toAuthUser(user);
  if (authUser) {
    authUserCache.set(decoded.userId, { user: authUser, expiresAt: now + AUTH_CACHE_TTL_MS });
  }
  return authUser;
}

type GuardOk = { ok: true; user: AuthUser };
type GuardFail = { ok: false; response: NextResponse };

export async function guardApi(
  req: NextRequest,
  permission?: Permission | 'authenticated'
): Promise<GuardOk | GuardFail> {
  const user = await getAuthUser(req);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (permission && permission !== 'authenticated' && !hasPermission(user.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: your role cannot perform this action' },
        { status: 403 }
      ),
    };
  }

  const pathname = req.nextUrl.pathname;
  if (!canAccessApi(user.role, pathname, req.method)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: your role cannot access this resource' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}

export function depotIdFilter(user: AuthUser): string | undefined {
  if (isDepotScoped(user) && user.assignedDepotId) return user.assignedDepotId;
  return undefined;
}

export function assertDepotAccess(user: AuthUser, depotId: string | null | undefined): NextResponse | null {
  const scoped = depotIdFilter(user);
  if (!scoped) return null;
  if (!depotId || depotId !== scoped) {
    return NextResponse.json(
      { error: 'Forbidden: this record is outside your assigned depot' },
      { status: 403 }
    );
  }
  return null;
}

export function sanitizeProductForRole<T extends Record<string, any>>(product: T, role: string): T {
  const unifiedProduct = {
    ...product,
    imageUrl: '/placeholder-product.svg',
  };
  if (canViewCosts(role)) return unifiedProduct as unknown as T;
  const { purchasePrice, ...rest } = unifiedProduct;
  return { ...rest, purchasePrice: undefined } as unknown as T;
}

export function redactSettings<T extends Record<string, any>>(
  settings: T | null,
  authenticated: boolean,
  role?: string
): Record<string, unknown> | null {
  if (!settings) return null;
  const isSmtpConfigured = Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.SMTP_PASSWORD)) ||
    (settings.smtpHost && settings.smtpUser && settings.smtpPassword)
  );

  const publicFields = {
    id: settings.id,
    companyName: settings.companyName,
    tradingName: settings.tradingName,
    logoUrl: settings.logoUrl,
    companyAddress: settings.companyAddress,
    phone: settings.phone,
    email: settings.email,
    website: settings.website,
    currency: settings.currency,
    currencySymbol: settings.currencySymbol,
    invoicePrefix: settings.invoicePrefix,
    proformaPrefix: settings.proformaPrefix,
    defaultPaymentTerms: settings.defaultPaymentTerms,
    defaultDeliveryTerms: settings.defaultDeliveryTerms,
    taxRegistrationNumber: settings.taxRegistrationNumber,
    vatGstNumber: settings.vatGstNumber,
    corporateTaxNumber: settings.corporateTaxNumber,
    tradeLicenceNumber: settings.tradeLicenceNumber,
    dunsNumber: settings.dunsNumber,
    freightVolumetricDivisor: settings.freightVolumetricDivisor,
    freightDefaultRatePerKg: settings.freightDefaultRatePerKg,
    isSmtpConfigured,
  };

  if (!authenticated) return publicFields;
  if (role === 'SUPER_ADMIN') {
    const { smtpPassword, ...rest } = settings;
    return { ...rest, smtpPassword: smtpPassword ? '********' : '', isSmtpConfigured };
  }
  return {
    ...publicFields,
    bankName: settings.bankName,
    accountName: settings.accountName,
    iban: settings.iban,
    swiftBic: settings.swiftBic,
  };
}

export function stripUserSecrets<T extends Record<string, any>>(user: T) {
  const { passwordHash, ...rest } = user;
  return rest;
}
