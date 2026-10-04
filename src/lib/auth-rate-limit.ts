/**
 * Brute-force protection for sign-in, backed by the database so it holds across serverless instances.
 * Failed attempts are counted per client address and per target (account email, or a global bucket for depot codes).
 * After too many failures within the window, further attempts are refused until the oldest counted failure ages out.
 */
import 'server-only';
import { createHmac } from 'crypto';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export const WINDOW_MS = 15 * 60 * 1000;

export interface Policy { scope: string; max: number }
/** Per client address, per account, and a generous global ceiling against a distributed guessing attack on depot codes. */
export const POLICIES = {
  depotIp: { scope: 'depot-ip', max: 8 },
  depotGlobal: { scope: 'depot-global', max: 150 },
  staffIp: { scope: 'staff-ip', max: 10 },
  staffEmail: { scope: 'staff-email', max: 6 },
} satisfies Record<string, Policy>;

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : req.headers.get('x-real-ip')) || '';
  return ip.trim().slice(0, 64) || 'unknown';
}

/** Keys are stored hashed so the table holds no raw addresses or e-mails. */
export function bucketKey(value: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET || 'rate-limit';
  return createHmac('sha256', secret).update(value.toLowerCase()).digest('hex').slice(0, 32);
}

export async function lockStatus(policy: Policy, key: string): Promise<{ locked: boolean; retryAfterSec: number }> {
  const since = new Date(Date.now() - WINDOW_MS);
  const fails = await prisma.authAttempt.findMany({
    where: { scope: policy.scope, key, success: false, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: policy.max,
    select: { createdAt: true },
  });
  if (fails.length < policy.max) return { locked: false, retryAfterSec: 0 };
  // unlocks when the oldest of the counted failures leaves the window
  const oldest = fails[fails.length - 1].createdAt.getTime();
  return { locked: true, retryAfterSec: Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)) };
}

export async function recordAttempt(policy: Policy, key: string, success: boolean) {
  if (success) {
    // a good sign-in clears that bucket's earlier failures
    await prisma.authAttempt.deleteMany({ where: { scope: policy.scope, key, success: false } }).catch(() => {});
    return;
  }
  await prisma.authAttempt.create({ data: { scope: policy.scope, key, success: false } }).catch(() => {});
  if (Math.random() < 0.05) {
    await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => {});
  }
}

/** The longest wait among the given buckets, or null when none is locked. */
export async function firstLock(checks: Array<[Policy, string]>): Promise<number | null> {
  let worst: number | null = null;
  for (const [policy, key] of checks) {
    const s = await lockStatus(policy, key);
    if (s.locked) worst = Math.max(worst ?? 0, s.retryAfterSec);
  }
  return worst;
}
