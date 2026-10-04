/**
 * Depot management: create / edit / activate / deactivate, and the access-code lifecycle.
 * All of it runs on the server; the access code is returned in the one response that creates or regenerates it and is
 * never stored, logged or audited in readable form. Nothing here deletes data: deactivating a depot only blocks sign-in.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { generateAccessCode, hashAccessCode } from '@/lib/depot-access';
import { writeAudit, type Actor } from '@/lib/audit';
import { invalidateAuthUserCache, invalidateDepotSessions } from '@/lib/api-auth';

export class DepotError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface DepotInput {
  name?: unknown; code?: unknown; city?: unknown; country?: unknown; address?: unknown;
  contactPerson?: unknown; phone?: unknown; email?: unknown; notes?: unknown; status?: unknown;
}

/** What the admin screens may see about a depot. Never includes the access-code hash. */
export function depotView(d: any) {
  return {
    id: d.id, code: d.code, name: d.name, city: d.city, country: d.country, address: d.address,
    contactPerson: d.contactPerson, phone: d.phone, email: d.email, notes: d.notes ?? '', isCentralHub: d.isCentralHub,
    status: d.status, deactivatedAt: d.deactivatedAt, createdAt: d.createdAt, updatedAt: d.updatedAt, createdByName: d.createdByName ?? null,
    hasAccessCode: !!d.accessCodeHash, accessCodeRotatedAt: d.accessCodeRotatedAt ?? null, accessCodeRevokedAt: d.accessCodeRevokedAt ?? null,
  };
}

function validate(input: DepotInput, creating: boolean) {
  const out = {
    name: str(input.name), city: str(input.city), country: str(input.country), address: str(input.address, 300),
    contactPerson: str(input.contactPerson), phone: str(input.phone, 40), email: str(input.email, 200).toLowerCase(),
    notes: str(input.notes, 1000), code: str(input.code, 20).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
  };
  const required: [string, string][] = [['Depot name', out.name], ['Location', out.city], ['Address', out.address], ['Contact person', out.contactPerson], ['Contact number', out.phone], ['Email', out.email]];
  if (creating) required.unshift(['Depot code', out.code]);
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new DepotError(400, `Required: ${missing.join(', ')}.`);
  if (!EMAIL_RE.test(out.email)) throw new DepotError(400, 'Enter a valid email address.');
  if (creating && out.code.length < 2) throw new DepotError(400, 'The depot code must be at least 2 characters (letters, digits, dashes).');
  if (!out.country) out.country = '—';
  return out;
}

export async function createDepot(input: DepotInput, actor: Actor, ip?: string) {
  const v = validate(input, true);
  if (await prisma.depot.findUnique({ where: { code: v.code }, select: { id: true } })) {
    throw new DepotError(409, `Depot code ${v.code} is already in use.`);
  }
  const status = input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';

  // The code is generated and hashed here; only the hash is saved.
  const accessCode = generateAccessCode();
  const hash = hashAccessCode(accessCode)!;
  const depot = await prisma.depot.create({
    data: {
      code: v.code, name: v.name, city: v.city, country: v.country, address: v.address, contactPerson: v.contactPerson,
      phone: v.phone, email: v.email, notes: v.notes || null, isCentralHub: false, status,
      deactivatedAt: status === 'INACTIVE' ? new Date() : null,
      createdById: actor.id, createdByName: actor.name,
      accessCodeHash: hash, accessCodeVersion: 1, accessCodeRotatedAt: new Date(),
    },
  });
  await writeAudit(actor, { action: 'DEPOT_CREATED', entityType: 'Depot', entityId: depot.id, entityLabel: `${depot.name} (${depot.code})`, description: `Depot ${depot.name} (${depot.code}) created`, ip, depotId: depot.id, depotName: depot.name });
  await writeAudit(actor, { action: 'ACCESS_CODE_GENERATED', entityType: 'Depot', entityId: depot.id, entityLabel: `${depot.name} (${depot.code})`, description: `Access code generated for ${depot.name}`, ip, depotId: depot.id, depotName: depot.name });
  return { depot: depotView(depot), accessCode };
}

export async function updateDepot(id: string, input: DepotInput, actor: Actor, ip?: string) {
  const existing = await prisma.depot.findUnique({ where: { id } });
  if (!existing) throw new DepotError(404, 'Depot not found.');
  const v = validate(input, false);
  const data = { name: v.name, city: v.city, country: v.country, address: v.address, contactPerson: v.contactPerson, phone: v.phone, email: v.email, notes: v.notes || null };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (existing as any)[k] !== (data as any)[k] && !(k === 'notes' && !existing.notes && !data.notes));
  if (!changed.length) return depotView(existing);

  const depot = await prisma.$transaction(async (tx) => {
    const d = await tx.depot.update({ where: { id }, data });
    if (data.name !== existing.name) {
      // keep the denormalised depot name on its users and on open documents in step
      await tx.user.updateMany({ where: { assignedDepotId: id }, data: { assignedDepotName: data.name } });
      await tx.taxInvoice.updateMany({ where: { depotId: id }, data: { depotName: data.name } });
    }
    return d;
  });
  await writeAudit(actor, {
    action: 'DEPOT_EDITED', entityType: 'Depot', entityId: id, entityLabel: `${depot.name} (${depot.code})`,
    description: `Depot ${depot.name} edited (${changed.join(', ')})`, ip, depotId: id, depotName: depot.name,
    previousValue: Object.fromEntries(changed.map((k) => [k, (existing as any)[k]])), newValue: Object.fromEntries(changed.map((k) => [k, (data as any)[k]])),
  });
  return depotView(depot);
}

/** Deactivating blocks sign-in and ends running depot sessions; every record is kept. */
export async function setDepotStatus(id: string, status: 'ACTIVE' | 'INACTIVE', actor: Actor, ip?: string) {
  const existing = await prisma.depot.findUnique({ where: { id } });
  if (!existing) throw new DepotError(404, 'Depot not found.');
  if (existing.status === status) throw new DepotError(409, `This depot is already ${status.toLowerCase()}.`);

  const depot = await prisma.$transaction(async (tx) => {
    const d = await tx.depot.update({
      where: { id },
      data: status === 'INACTIVE'
        ? { status, deactivatedAt: new Date(), accessCodeVersion: { increment: 1 } }
        : { status, deactivatedAt: null },
    });
    if (status === 'INACTIVE') {
      // sign out everyone working in this depot, right away
      await tx.user.updateMany({ where: { assignedDepotId: id }, data: { sessionVersion: { increment: 1 } } });
    }
    return d;
  });
  invalidateDepotSessions(id);
  await writeAudit(actor, {
    action: status === 'ACTIVE' ? 'DEPOT_ACTIVATED' : 'DEPOT_DEACTIVATED', entityType: 'Depot', entityId: id, entityLabel: `${depot.name} (${depot.code})`,
    description: status === 'ACTIVE' ? `Depot ${depot.name} activated` : `Depot ${depot.name} deactivated: sign-in blocked, sessions ended, data preserved`,
    ip, depotId: id, depotName: depot.name, previousValue: existing.status, newValue: status,
  });
  return depotView(depot);
}

/** Replaces the access code. The previous code stops working at once and is never shown again. */
export async function regenerateAccessCode(id: string, actor: Actor, ip?: string) {
  const existing = await prisma.depot.findUnique({ where: { id } });
  if (!existing) throw new DepotError(404, 'Depot not found.');
  const accessCode = generateAccessCode();
  const depot = await prisma.depot.update({
    where: { id },
    data: { accessCodeHash: hashAccessCode(accessCode)!, accessCodeVersion: { increment: 1 }, accessCodeRotatedAt: new Date(), accessCodeRevokedAt: null },
  });
  invalidateDepotSessions(id);
  await writeAudit(actor, {
    action: existing.accessCodeHash ? 'ACCESS_CODE_REGENERATED' : 'ACCESS_CODE_GENERATED', entityType: 'Depot', entityId: id, entityLabel: `${depot.name} (${depot.code})`,
    description: `Access code ${existing.accessCodeHash ? 'regenerated' : 'generated'} for ${depot.name}`, ip, depotId: id, depotName: depot.name,
  });
  return { depot: depotView(depot), accessCode };
}

/** Removes the depot's ability to sign in with a code until a new one is generated. */
export async function revokeAccessCode(id: string, actor: Actor, ip?: string) {
  const existing = await prisma.depot.findUnique({ where: { id } });
  if (!existing) throw new DepotError(404, 'Depot not found.');
  if (!existing.accessCodeHash) throw new DepotError(409, 'This depot has no active access code.');
  const depot = await prisma.depot.update({
    where: { id },
    data: { accessCodeHash: null, accessCodeVersion: { increment: 1 }, accessCodeRevokedAt: new Date() },
  });
  invalidateDepotSessions(id);
  const station = await prisma.user.findFirst({ where: { assignedDepotId: id, isStation: true }, select: { id: true } });
  if (station) invalidateAuthUserCache(station.id);
  await writeAudit(actor, {
    action: 'ACCESS_CODE_REVOKED', entityType: 'Depot', entityId: id, entityLabel: `${depot.name} (${depot.code})`,
    description: `Access code revoked for ${depot.name}`, ip, depotId: id, depotName: depot.name,
  });
  return depotView(depot);
}

/** Overview numbers for the management table / dashboard. Always filtered by depotId. */
export async function depotStats(depotIds: string[]) {
  const [users, stock, active, shipped] = await Promise.all([
    prisma.user.groupBy({ by: ['assignedDepotId'], where: { assignedDepotId: { in: depotIds }, isStation: false }, _count: { _all: true } }),
    prisma.depotInventory.groupBy({ by: ['depotId'], where: { depotId: { in: depotIds } }, _sum: { quantity: true } }),
    prisma.taxInvoice.groupBy({ by: ['depotId'], where: { depotId: { in: depotIds }, documentStatus: { not: 'DRAFT' }, fulfilmentStatus: { in: ['READY_FOR_PACKING', 'PROCESSING', 'PACKED'] } }, _count: { _all: true } }),
    prisma.taxInvoice.groupBy({ by: ['depotId'], where: { depotId: { in: depotIds }, fulfilmentStatus: 'SHIPPED' }, _count: { _all: true } }),
  ]);
  const map: Record<string, { users: number; stockUnits: number; activeOrders: number; shipped: number }> = {};
  for (const id of depotIds) map[id] = { users: 0, stockUnits: 0, activeOrders: 0, shipped: 0 };
  users.forEach((r) => { if (r.assignedDepotId) map[r.assignedDepotId].users = r._count._all; });
  stock.forEach((r) => { map[r.depotId].stockUnits = r._sum.quantity || 0; });
  active.forEach((r) => { map[r.depotId].activeOrders = r._count._all; });
  shipped.forEach((r) => { map[r.depotId].shipped = r._count._all; });
  return map;
}
