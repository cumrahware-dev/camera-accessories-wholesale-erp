import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { verifyAuthPayload } from '@/lib/auth-token';
import {
  AuthSession,
  Permission,
  canAccessApi,
  resolveApiAccess,
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
  /** Permissions a Super Admin removed from this person's role. */
  permissionRevokes: string[];
  /** True for the shared sign-in behind a depot access code. */
  isStation: boolean;
};

type RawUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  assignedDepotId?: string | null;
  assignedDepotName?: string | null;
  avatar?: string | null;
  phone?: string | null;
  status: string;
  permissionRevokes?: string[] | null;
  isStation?: boolean | null;
};

function toAuthUser(user: RawUser): AuthUser | null {
  if (!isUserRole(user.role)) return null;
  return {
    id: user.id,
    userId: user.id,
    name: user.name || user.email,
    email: user.email,
    role: user.role,
    assignedDepotId: user.assignedDepotId,
    assignedDepotName: user.assignedDepotName,
    avatar: user.avatar,
    phone: user.phone,
    status: user.status,
    permissionRevokes: user.permissionRevokes || [],
    isStation: !!user.isStation,
  };
}

export function publicUserView(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.isStation ? '' : user.email,
    role: user.role,
    assignedDepotId: user.assignedDepotId,
    assignedDepotName: user.assignedDepotName,
    avatar: user.avatar,
    phone: user.phone,
    status: user.status,
    permissionRevokes: user.permissionRevokes,
    isStation: user.isStation,
  };
}

// Short-lived cache of validated sessions (saves a database round trip per concurrent request).
// The TTL is also the worst-case delay before a disabled user / revoked depot code stops working on ANOTHER server
// instance; on the instance that made the change the cache is cleared immediately.
const authUserCache = new Map<string, { user: AuthUser; key: string; expiresAt: number }>();
// With a database ~300ms away, re-validating on every request costs more than the page itself, so a validated
// session is trusted for this long. On the server instance that makes a change (disable user, deactivate depot,
// regenerate code) the cache is cleared immediately; other instances notice within this window.
const AUTH_CACHE_TTL_MS = Math.min(120, Math.max(1, Number(process.env.AUTH_CACHE_TTL_SECONDS) || 30)) * 1000;

export function invalidateAuthUserCache(userId?: string) {
  if (userId) {
    authUserCache.delete(userId);
  } else {
    authUserCache.clear();
  }
}

/** Drops cached sessions for everyone assigned to a depot (used when a depot is deactivated or its code changes). */
export function invalidateDepotSessions(depotId: string) {
  authUserCache.forEach((v, k) => {
    if (v.user.assignedDepotId === depotId) authUserCache.delete(k);
  });
}

/**
 * Resolves the signed-in user from the session cookie and re-validates it against the database on every request:
 * the account must be ACTIVE, its session version must match, and for depot users the depot must exist and be
 * ACTIVE (and, for depot-code sessions, the access code must not have been regenerated or revoked).
 * Fails closed: if the database cannot be reached nobody is authenticated.
 */
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.cookies.get('erp_auth_token')?.value;
  const decoded = await verifyAuthPayload(token);
  if (!decoded?.userId) return null;

  const now = Date.now();
  const cacheKey = `${decoded.sv ?? 0}:${decoded.av ?? 0}`;
  const cached = authUserCache.get(decoded.userId);
  if (cached && cached.expiresAt > now && cached.key === cacheKey) {
    return cached.user;
  }

  let user: any = null;
  try {
    // One round trip: the user and their depot in a single statement (Prisma would issue two for an include).
    const rows = await prisma.$queryRaw<any[]>`
      SELECT u.id, u.name, u.email, u.role::text AS role, u."assignedDepotId", u."assignedDepotName", u.avatar, u.phone,
             u.status::text AS status, u."sessionVersion", u."permissionRevokes", u."isStation",
             d.status::text AS "depotStatus", d.name AS "depotName", d."accessCodeVersion", (d."accessCodeHash" IS NOT NULL) AS "depotHasCode"
        FROM "User" u LEFT JOIN "Depot" d ON d.id = u."assignedDepotId"
       WHERE u.id = ${decoded.userId} LIMIT 1`;
    user = rows[0] ?? null;
    if (user) user.depot = user.depotStatus ? { status: user.depotStatus, name: user.depotName, accessCodeVersion: user.accessCodeVersion, accessCodeHash: user.depotHasCode ? 'set' : null } : null;
  } catch {
    return null;
  }

  if (!user || user.status !== 'ACTIVE') return null;
  if ((decoded.sv ?? 0) !== user.sessionVersion) return null;
  if (isUserRole(user.role) && isDepotScoped({ userId: user.id, email: user.email, role: user.role, assignedDepotId: user.assignedDepotId })) {
    if (user.assignedDepotId) {
      if (!user.depot || user.depot.status !== 'ACTIVE') return null;
      if (user.isStation && (!user.depot.accessCodeHash || (decoded.av ?? -1) !== user.depot.accessCodeVersion)) return null;
    } else if (user.isStation) {
      return null;
    }
  }

  const authUser = toAuthUser({ ...user, assignedDepotName: user.depot?.name ?? user.assignedDepotName });
  if (authUser) {
    authUserCache.set(decoded.userId, { user: authUser, key: cacheKey, expiresAt: now + AUTH_CACHE_TTL_MS });
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

  const forbidden = (msg: string): GuardFail => ({ ok: false, response: NextResponse.json({ error: msg }, { status: 403 }) });

  if (permission && permission !== 'authenticated' && !hasPermission(user.role, permission, user.permissionRevokes)) {
    return forbidden('Forbidden: your role cannot perform this action');
  }

  // The permission the API rules demand for this exact path + method is always enforced, including per-user revokes,
  // even for handlers that only call guardApi(req).
  const pathname = req.nextUrl.pathname;
  if (!canAccessApi(user.role, pathname, req.method)) {
    return forbidden('Forbidden: your role cannot access this resource');
  }
  const required = resolveApiAccess(pathname, req.method);
  if (required !== 'public' && required !== 'authenticated' && !hasPermission(user.role, required, user.permissionRevokes)) {
    return forbidden('Forbidden: your access to this resource was restricted by an administrator');
  }

  return { ok: true, user };
}

/** Value used when a depot-bound user has no depot assigned: matches no record, so they see nothing. */
export const NO_DEPOT = '__no_depot_assigned__';

/** The depot a user is confined to, or undefined for users with company-wide access. */
export function depotIdFilter(user: AuthUser): string | undefined {
  if (!isDepotScoped(user)) return undefined;
  return user.assignedDepotId || NO_DEPOT;
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
  const { passwordHash, sessionVersion, ...rest } = user;
  return rest;
}
