import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbTimeout } from '@/lib/prisma';
import dataStore from '@/lib/data-store';
import { getAuthUser, redactSettings } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';

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

    const body = await req.json();
    cachedSettingsData = null;

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
