'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchCurrentUserCached, getCurrentUserCachedSync } from '@/lib/client-cache';
import { hasPermission, type Permission } from '@/lib/rbac';

export interface Me {
  id: string; name: string; email: string; role: string;
  assignedDepotId?: string | null; assignedDepotName?: string | null;
  permissionRevokes?: string[]; isStation?: boolean;
}

/**
 * The signed-in user plus a `can()` check that uses the same permission matrix as the server (including per-user
 * restrictions). This only decides what to SHOW; the server enforces every action regardless.
 */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const cached = getCurrentUserCachedSync()?.user as Me | undefined;
    if (cached) setMe(cached);
    fetchCurrentUserCached().then((d) => { if (alive) { setMe((d?.user as Me) ?? null); setLoaded(true); } }).catch(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, []);
  const can = useCallback((p: Permission) => !!me && hasPermission(me.role, p, me.permissionRevokes), [me]);
  return { me, can, loaded };
}
