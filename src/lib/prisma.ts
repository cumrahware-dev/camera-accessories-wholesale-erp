import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
  prismaHealthy: boolean;
  prismaLastCheck: number;
};

// Track whether the DB is reachable so we can skip slow queries
// and fall back to dataStore immediately.
if (globalForPrisma.prismaHealthy === undefined) {
  globalForPrisma.prismaHealthy = true; // optimistic start
  globalForPrisma.prismaLastCheck = 0;
}

const HEALTH_RECHECK_MS = 10_000; // re-probe DB every 10 seconds after a connection failure
const QUERY_TIMEOUT_MS = Math.max(5_000, Number(process.env.DB_QUERY_TIMEOUT_MS) || 30_000);

/** Only a failure to reach the database counts as "offline"; a query that is merely slow must never trip it. */
export function isConnectionError(err: any): boolean {
  const code = err?.code as string | undefined;
  return (
    err?.name === 'PrismaClientInitializationError' ||
    code === 'P1001' || code === 'P1002' || code === 'P1017' || code === 'P1000' || code === 'P1011'
  );
}

export function isDbOffline(): boolean {
  if (globalForPrisma.prismaHealthy) return false;
  // If enough time has passed since the last failure, allow one re-probe
  if (Date.now() - globalForPrisma.prismaLastCheck > HEALTH_RECHECK_MS) {
    globalForPrisma.prismaHealthy = true; // allow re-probe
    return false;
  }
  return true; // offline
}

export function markDbOffline(): void {
  if (globalForPrisma.prismaHealthy) {
    console.warn('\n[Prisma] Database marked as OFFLINE (connection error). Future requests fail fast for 10s.\n');
  }
  globalForPrisma.prismaHealthy = false;
  globalForPrisma.prismaLastCheck = Date.now();
}

export function markDbOnline(): void {
  globalForPrisma.prismaHealthy = true;
}

// Profiling (PERF_LOG=1 only): counts every query and its database time so slow / chatty endpoints can be found.
// Off by default; with the flag unset Prisma is created exactly as before and nothing here runs.
const PERF = process.env.PERF_LOG === '1';

// Prisma's default for an interactive $transaction is 5s. Every statement inside costs one round trip to the database,
// so over a remote database even a modest multi-line operation (shipping an order, converting a proforma) can pass
// 5s and be rolled back although nothing is wrong. Give transactions room; the guards inside them still apply.
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
export const perfStats: { count: number; ms: number; log: { q: string; ms: number }[] } =
  ((global as any).__perfStats ??= { count: 0, ms: 0, log: [] });

const realPrisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient(
  PERF
    ? ({ log: [{ emit: 'event', level: 'query' }, 'error'], transactionOptions: TX_OPTIONS } as any)
    : { log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'], transactionOptions: TX_OPTIONS }
);
if (PERF) {
  // Next can load this module more than once (instrumentation vs route bundles), so hook every client created here.
  (realPrisma as any).$on('query', (e: any) => {
    perfStats.count++;
    perfStats.ms += e.duration;
    perfStats.log.push({ q: String(e.query).replace(/\s+/g, ' ').slice(0, 220), ms: e.duration });
    if (perfStats.log.length > 4000) perfStats.log.splice(0, 2000);
  });
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = realPrisma;

// We wrap the PrismaClient in a Proxy.
// When any method (e.g. prisma.user.findUnique) is called, it returns a Promise.
// We intercept that Promise. If the DB is known to be offline, we reject INSTANTLY (0ms).
// Otherwise, we race the real Prisma promise against a short timeout.
export const prisma = new Proxy(realPrisma, {
  get(target, prop) {
    const value = Reflect.get(target, prop);
    
    if (typeof value === 'function') {
      return function (...args: any[]) {
        return value.apply(target, args);
      };
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return new Proxy(value, {
        get(modelTarget, modelProp) {
          const modelValue = Reflect.get(modelTarget, modelProp);
          if (typeof modelValue === 'function') {
            return function (...args: any[]) {
              if (isDbOffline()) {
                return Promise.reject(new Error('Database is offline (cached), bypassing Prisma'));
              }
              const realPromise = modelValue.apply(modelTarget, args);
              
              let timer: NodeJS.Timeout;
              // Safety net only. With a far-away database a heavy-but-healthy request can take many seconds; timing out
              // must NOT mark the whole database offline (that used to fail every other request for 10 seconds and
              // switch pages to the in-memory demo store).
              const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Database query timed out')), QUERY_TIMEOUT_MS);
              });

              return Promise.race([realPromise, timeoutPromise]).then(
                (result) => {
                  clearTimeout(timer);
                  // DB responded — mark it as healthy again
                  if (!globalForPrisma.prismaHealthy) markDbOnline();
                  return result;
                },
                (err) => {
                  clearTimeout(timer);
                  if (isConnectionError(err)) markDbOffline();
                  throw err;
                }
              );
            };
          }
          return modelValue;
        }
      });
    }
    return value;
  }
}) as PrismaClient;

export async function withDbTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = 1500
): Promise<T> {
  // The fast proxy already handles the timeout and rejection instantly!
  // We just return the operation directly to keep the API compatible.
  return operation();
}
