import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { getAuthUser, redactSettings } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { invalidateCompanySettingsCache } from '@/lib/settings-cache';

let cachedSettingsData: any = null;
let settingsCacheExpiresAt = 0;
const SETTINGS_CACHE_TTL_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    const now = Date.now();

    if (!cachedSettingsData || now >= settingsCacheExpiresAt) {
      try {
        cachedSettingsData = await withDbTimeout(() =>
          prisma.companySettings.findUnique({
            where: { id: 'global-settings' },
          })
        );
      } catch (dbErr: any) {}

      if (!cachedSettingsData) {
        cachedSettingsData = dataStore.getCompanySettings();
      }
      settingsCacheExpiresAt = now + SETTINGS_CACHE_TTL_MS;
    }

    return NextResponse.json(
      redactSettings(cachedSettingsData as any, Boolean(user), user?.role),
      {
        headers: {
          // Authenticated responses contain non-public fields, so they must never be cached by shared caches.
          'Cache-Control': user ? 'private, no-store' : 'public, s-maxage=60, stale-while-revalidate=300',
          Vary: 'Cookie',
        },
      }
    );
  } catch (error) {
    console.error('Settings API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasPermission(user.role, 'settings.write')) {
      return NextResponse.json({ error: 'Forbidden: only Super Admin can update settings' }, { status: 403 });
    }

    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    // Only these sections are edited through this endpoint. Company, address, TRN, bank and numbering are managed
    // (validated) under Settings -> Company & Business Details (/api/company); anything else in the body is ignored.
    const body: Record<string, any> = {};
    for (const k of ['smtpHost', 'smtpUser', 'smtpFromName', 'smtpFromEmail']) if (typeof raw[k] === 'string') body[k] = raw[k].trim().slice(0, 200);
    if (raw.smtpPort !== undefined) {
      const port = Number(raw.smtpPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: 'SMTP port must be between 1 and 65535.' }, { status: 400 });
      body.smtpPort = port;
    }
    // The form shows the stored password masked; saving the mask must never overwrite the real password.
    if (typeof raw.smtpPassword === 'string' && raw.smtpPassword !== '********') body.smtpPassword = raw.smtpPassword;
    for (const k of ['freightVolumetricDivisor', 'freightDefaultRatePerKg']) {
      if (raw[k] !== undefined) {
        const n = Number(raw[k]);
        if (!Number.isFinite(n) || n < 0 || (k === 'freightVolumetricDivisor' && n === 0)) return NextResponse.json({ error: 'Freight settings must be positive numbers.' }, { status: 400 });
        body[k] = n;
      }
    }
    cachedSettingsData = null;
    invalidateCompanySettingsCache();

    let settings: any = null;
    try {
      settings = await prisma.companySettings.update({
        where: { id: 'global-settings' },
        data: body,
      });
    } catch (dbErr) {
      settings = dataStore.updateCompanySettings(body);
    }

    if (!settings) {
      settings = dataStore.updateCompanySettings(body);
    }

    return NextResponse.json(redactSettings(settings as any, true, user.role));
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
