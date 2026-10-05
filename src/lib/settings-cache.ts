/**
 * Read-only copy of the company settings, cached on the server for a short time.
 *
 * The settings row is read by almost every PDF, email and portal page just to print the company name, address or bank
 * details, which with a remote database cost a full round trip each time. These values change rarely, so a one-minute
 * cache is safe for DISPLAY. It must NOT be used where the authoritative value matters:
 *   - invoice / proforma numbering (it increments inside its own transaction, always against the database)
 *   - anything that writes settings back
 * Saving the settings (PATCH /api/settings) clears this cache immediately on that server instance.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';

const TTL_MS = 60_000;
const g = globalThis as unknown as { __settingsCache?: { value: any; expires: number; pending?: Promise<any> } };
const cache = (g.__settingsCache ??= { value: null, expires: 0 });

export async function getCompanySettingsCached(): Promise<any | null> {
  if (cache.value && Date.now() < cache.expires) return cache.value;
  // share one in-flight read between concurrent callers
  cache.pending ??= prisma.companySettings
    .findUnique({ where: { id: 'global-settings' } })
    .then((row) => { if (row) { cache.value = row; cache.expires = Date.now() + TTL_MS; } return row; })
    .catch(() => cache.value ?? null)
    .finally(() => { cache.pending = undefined; });
  return cache.pending;
}

export function invalidateCompanySettingsCache() {
  cache.value = null;
  cache.expires = 0;
}
