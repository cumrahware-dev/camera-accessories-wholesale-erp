/**
 * Single entry point for the AuditLog table (shown on /audit-logs).
 * Best-effort: a failed audit write never breaks the action.
 * NEVER pass secrets (passwords, access codes) in any field.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';

export interface Actor { id: string; name: string; role: string }

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  description: string;
  previousValue?: unknown;
  newValue?: unknown;
  depotId?: string | null;
  depotName?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/** `actor` may be null for events with no signed-in user (for example a failed sign-in). */
export async function writeAudit(actor: Actor | null, a: AuditEntry) {
  try {
    let userId: string | null = null;
    if (actor) {
      const exists = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true } });
      userId = exists ? actor.id : null;
    }
    await prisma.auditLog.create({
      data: {
        userId,
        userName: actor?.name || 'Not signed in',
        userRole: (actor?.role as any) || 'VIEWER',
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        entityLabel: a.entityLabel,
        description: a.description,
        previousValue: a.previousValue === undefined ? null : JSON.stringify(a.previousValue),
        newValue: a.newValue === undefined ? null : JSON.stringify(a.newValue),
        depotId: a.depotId ?? null,
        depotName: a.depotName ?? null,
        ipAddress: a.ip || undefined,
        metadata: (a.metadata as any) ?? undefined,
      },
    });
  } catch (e: any) {
    console.warn('[audit] could not write audit log:', e?.message);
  }
}
