/**
 * User management. Every change is validated on the server, audited, and ends the person's existing sessions
 * when it changes what they can do. Users are never deleted: they are disabled, so their history stays intact.
 *
 * `scope` is used for Depot Managers: they can only see and manage staff of their OWN depot, and only the
 * staff-level roles.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { generateAccessCode } from '@/lib/depot-access';
import { generateErpAccessCode } from '@/lib/erp-access';
import { writeAudit, type Actor } from '@/lib/audit';
import { invalidateAuthUserCache } from '@/lib/api-auth';
import { ALL_ROLES, ROLE_LABELS, isDepotRole, listPermissions, type Permission, type UserRole } from '@/lib/rbac';

export class UserError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export interface Scope { depotId: string; allowedRoles: UserRole[] }
/** Roles a Depot Manager may hand out. */
export const DEPOT_STAFF_ROLES: UserRole[] = ['DEPOT_STAFF', 'DEPOT_SCANNER'];
/** A Depot Manager's scope: their own depot (taken from the session, never from the request) and staff roles only. */
export function depotScopeOf(user: { assignedDepotId?: string | null }): Scope | null {
  return user.assignedDepotId ? { depotId: user.assignedDepotId, allowedRoles: DEPOT_STAFF_ROLES } : null;
}
const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
type Status = (typeof STATUSES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function userView(u: any) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? '',
    role: u.role,
    status: u.status,
    accessArea: isDepotRole(u.role) ? 'DEPOT' : 'ERP',
    assignedDepotId: u.assignedDepotId ?? null,
    assignedDepotName: u.depot?.name ?? u.assignedDepotName ?? null,
    depotCode: u.depot?.code ?? null,
    lastLogin: u.lastLogin ?? null,
    createdAt: u.createdAt,
    createdByName: u.createdByName ?? null,
    permissionRevokes: u.permissionRevokes ?? [],
    hasAccessCode: !!u.passwordHash && u.passwordHash.length > 0,
  };
}

const include = { depot: { select: { id: true, name: true, code: true, status: true } } };

function needsDepot(role: UserRole) { return isDepotRole(role); }

async function resolveDepot(role: UserRole, depotId: unknown, scope?: Scope) {
  const wantsDepot = needsDepot(role) || (role === 'VIEWER' && !!depotId);
  const id = scope ? scope.depotId : str(depotId);
  if (!wantsDepot) return null;
  if (!id) throw new UserError(400, `${ROLE_LABELS[role]} accounts must be assigned to a depot.`);
  const depot = await prisma.depot.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!depot) throw new UserError(400, 'The selected depot does not exist.');
  return depot;
}

function checkRole(role: unknown, scope?: Scope): UserRole {
  if (!ALL_ROLES.includes(role as UserRole)) throw new UserError(400, 'Choose a valid role.');
  if (scope && !scope.allowedRoles.includes(role as UserRole)) throw new UserError(403, 'You can only assign depot staff roles.');
  return role as UserRole;
}

function checkRevokes(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new UserError(400, 'permissionRevokes must be a list.');
  const valid = new Set<string>(listPermissions('SUPER_ADMIN'));
  const bad = v.find((p) => typeof p !== 'string' || !valid.has(p));
  if (bad !== undefined) throw new UserError(400, 'Unknown permission in the restriction list.');
  return Array.from(new Set(v as string[]));
}

export async function listUsers(opts: { q?: string; role?: string; depotId?: string; status?: string; take: number; skip: number }, scope?: Scope) {
  const where: any = { isStation: false };
  if (scope) where.assignedDepotId = scope.depotId;
  else if (opts.depotId) where.assignedDepotId = opts.depotId;
  if (opts.role && ALL_ROLES.includes(opts.role as UserRole)) where.role = opts.role;
  if (opts.status && (STATUSES as readonly string[]).includes(opts.status)) where.status = opts.status;
  if (opts.q) {
    where.OR = [
      { name: { contains: opts.q, mode: 'insensitive' } },
      { email: { contains: opts.q, mode: 'insensitive' } },
      { assignedDepotName: { contains: opts.q, mode: 'insensitive' } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: opts.take, skip: opts.skip }),
    prisma.user.count({ where }),
  ]);
  return { users: rows.map(userView), total };
}

export async function getUser(id: string, scope?: Scope) {
  const u = await prisma.user.findFirst({ where: { id, isStation: false, ...(scope ? { assignedDepotId: scope.depotId } : {}) }, include });
  if (!u) throw new UserError(404, 'User not found.');
  return u;
}

export interface CreateUserInput { name?: unknown; email?: unknown; phone?: unknown; role?: unknown; depotId?: unknown; status?: unknown; accessCode?: unknown; password?: unknown; permissionRevokes?: unknown }

export async function createUser(input: CreateUserInput, actor: Actor, scope?: Scope, ip?: string) {
  const name = str(input.name, 120);
  const email = str(input.email, 200).toLowerCase();
  const phone = str(input.phone, 40);
  if (!name) throw new UserError(400, 'Enter the full name.');
  if (!EMAIL_RE.test(email)) throw new UserError(400, 'Enter a valid email address.');
  const role = checkRole(input.role, scope);
  const status: Status = (STATUSES as readonly string[]).includes(input.status as string) ? (input.status as Status) : 'ACTIVE';
  const depot = await resolveDepot(role, input.depotId, scope);
  const revokes = scope ? [] : checkRevokes(input.permissionRevokes);
  if (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
    throw new UserError(409, 'A user with this email already exists.');
  }

  // Access code generated on server and returned once to creator
  const rawCode = input.accessCode || input.password;
  const accessCode = typeof rawCode === 'string' && rawCode.trim()
    ? rawCode.trim()
    : isDepotRole(role)
      ? generateAccessCode()
      : generateErpAccessCode();

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone: phone || null,
      role,
      status,
      passwordHash: hashPassword(accessCode),
      permissionRevokes: revokes,
      assignedDepotId: depot?.id ?? null,
      assignedDepotName: depot?.name ?? null,
      createdById: actor.id,
      createdByName: actor.name,
    },
    include,
  });

  await writeAudit(actor, {
    action: 'USER_CREATED',
    entityType: 'User',
    entityId: user.id,
    entityLabel: `${user.name} <${user.email}>`,
    description: `User ${user.name} created as ${ROLE_LABELS[role]}${depot ? ` in ${depot.name}` : ''}`,
    ip,
    depotId: depot?.id,
    depotName: depot?.name,
    metadata: { role, status },
  });

  await writeAudit(actor, {
    action: 'ACCESS_CODE_GENERATED',
    entityType: 'User',
    entityId: user.id,
    entityLabel: `${user.name} <${user.email}>`,
    description: `Access code generated for ${user.name}`,
    ip,
    depotId: depot?.id,
    depotName: depot?.name,
  });

  return { user: userView(user), accessCode, temporaryPassword: accessCode };
}

export interface UpdateUserInput { name?: unknown; email?: unknown; phone?: unknown; role?: unknown; depotId?: unknown; status?: unknown; permissionRevokes?: unknown }

export async function updateUser(id: string, input: UpdateUserInput, actor: Actor, scope?: Scope, ip?: string) {
  const existing = await getUser(id, scope);
  if (scope && !scope.allowedRoles.includes(existing.role as UserRole)) throw new UserError(403, 'You can only manage depot staff accounts.');

  const data: any = {};
  const notes: string[] = [];
  if (input.name !== undefined) {
    const name = str(input.name, 120);
    if (!name) throw new UserError(400, 'Enter the full name.');
    if (name !== existing.name) { data.name = name; notes.push('name'); }
  }
  if (input.phone !== undefined) {
    const phone = str(input.phone, 40) || null;
    if (phone !== existing.phone) { data.phone = phone; notes.push('phone'); }
  }
  if (input.email !== undefined && !scope) {
    const email = str(input.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new UserError(400, 'Enter a valid email address.');
    if (email !== existing.email.toLowerCase()) {
      if (await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, NOT: { id } }, select: { id: true } })) {
        throw new UserError(409, 'A user with this email already exists.');
      }
      data.email = email; notes.push('email');
    }
  }

  const nextRole = input.role !== undefined ? checkRole(input.role, scope) : (existing.role as UserRole);
  let roleChanged = nextRole !== existing.role;
  let depotChanged = false;
  if (roleChanged || input.depotId !== undefined) {
    const depot = await resolveDepot(nextRole, input.depotId !== undefined ? input.depotId : existing.assignedDepotId, scope);
    const nextDepotId = depot?.id ?? null;
    if (roleChanged) { data.role = nextRole; }
    if (nextDepotId !== existing.assignedDepotId) { data.assignedDepotId = nextDepotId; data.assignedDepotName = depot?.name ?? null; depotChanged = true; }
  }
  if (input.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(input.status as string)) throw new UserError(400, 'Choose a valid status.');
    if (input.status !== existing.status) data.status = input.status;
  }
  if (input.permissionRevokes !== undefined && !scope) {
    const revokes = checkRevokes(input.permissionRevokes);
    if (JSON.stringify([...revokes].sort()) !== JSON.stringify([...(existing.permissionRevokes || [])].sort())) { data.permissionRevokes = revokes; notes.push('permissions'); }
  }

  // Safeguards
  const losesAdmin = existing.role === 'SUPER_ADMIN' && ((data.role && data.role !== 'SUPER_ADMIN') || (data.status && data.status !== 'ACTIVE'));
  if (id === actor.id && (data.status && data.status !== 'ACTIVE')) throw new UserError(400, 'You cannot disable your own account.');
  if (id === actor.id && data.role && data.role !== existing.role) throw new UserError(400, 'You cannot change your own role.');
  if (losesAdmin && (await prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', isStation: false } })) <= 1) {
    throw new UserError(400, 'Cannot disable or demote the last active Super Admin.');
  }
  if (!Object.keys(data).length) return userView(existing);

  // Anything that changes what the person may do ends their current sessions.
  const endSessions = !!(data.role || data.status || depotChanged || data.permissionRevokes);
  const updated = await prisma.user.update({ where: { id }, data: { ...data, ...(endSessions ? { sessionVersion: { increment: 1 } } : {}) }, include });
  if (endSessions) invalidateAuthUserCache(id);

  const base = { entityType: 'User', entityId: id, entityLabel: `${updated.name} <${updated.email}>`, ip, depotId: updated.assignedDepotId, depotName: updated.depot?.name ?? updated.assignedDepotName };
  if (notes.length) await writeAudit(actor, { ...base, action: 'USER_EDITED', description: `User ${updated.name} edited (${notes.join(', ')})` });
  if (data.role) await writeAudit(actor, { ...base, action: 'USER_ROLE_CHANGED', description: `${updated.name}: role ${ROLE_LABELS[existing.role as UserRole]} → ${ROLE_LABELS[data.role as UserRole]}`, previousValue: existing.role, newValue: data.role });
  if (depotChanged) await writeAudit(actor, { ...base, action: 'USER_DEPOT_CHANGED', description: `${updated.name}: depot ${existing.assignedDepotName || 'none'} → ${updated.assignedDepotName || 'none'}`, previousValue: existing.assignedDepotId, newValue: updated.assignedDepotId });
  if (data.status) {
    await writeAudit(actor, {
      ...base, action: data.status === 'ACTIVE' ? 'USER_ENABLED' : 'USER_DISABLED',
      description: `User ${updated.name} ${data.status === 'ACTIVE' ? 'enabled' : data.status === 'SUSPENDED' ? 'suspended' : 'disabled'}; ${data.status === 'ACTIVE' ? '' : 'sessions ended, records preserved'}`.trim(),
      previousValue: existing.status, newValue: data.status,
    });
  }
  return userView(updated);
}

/** Regenerate access code for a user. Previous code stops working immediately. */
export async function regenerateUserAccessCode(id: string, actor: Actor, scope?: Scope, ip?: string) {
  const target = await getUser(id, scope);
  if (scope && !scope.allowedRoles.includes(target.role as UserRole)) throw new UserError(403, 'You can only manage depot staff accounts.');
  const accessCode = isDepotRole(target.role as UserRole) ? generateAccessCode() : generateErpAccessCode();
  await prisma.user.update({
    where: { id },
    data: { passwordHash: hashPassword(accessCode), sessionVersion: { increment: 1 } },
  });
  invalidateAuthUserCache(id);
  await writeAudit(actor, {
    action: 'ACCESS_CODE_REGENERATED',
    entityType: 'User',
    entityId: id,
    entityLabel: `${target.name} <${target.email}>`,
    description: `Access code regenerated for ${target.name} (${target.role})`,
    ip,
    depotId: target.assignedDepotId,
    depotName: target.depot?.name,
  });
  return accessCode;
}

/** Revoke access code for a user. */
export async function revokeUserAccessCode(id: string, actor: Actor, scope?: Scope, ip?: string) {
  const target = await getUser(id, scope);
  if (scope && !scope.allowedRoles.includes(target.role as UserRole)) throw new UserError(403, 'You can only manage depot staff accounts.');
  await prisma.user.update({
    where: { id },
    data: { passwordHash: '', sessionVersion: { increment: 1 } },
  });
  invalidateAuthUserCache(id);
  await writeAudit(actor, {
    action: 'ACCESS_CODE_REVOKED',
    entityType: 'User',
    entityId: id,
    entityLabel: `${target.name} <${target.email}>`,
    description: `Access code revoked for ${target.name}`,
    ip,
    depotId: target.assignedDepotId,
    depotName: target.depot?.name,
  });
  return true;
}

/** Legacy alias kept for backwards-compatibility */
export const resetUserPassword = regenerateUserAccessCode;

export type { Permission };
