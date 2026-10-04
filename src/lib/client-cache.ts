'use client';

// Shared client-side request and memory cache for high-frequency ERP endpoints
// (auth, settings, depots, dashboard). Eliminates duplicate network requests,
// provides instantaneous synchronous hydration from memory/storage, and handles
// stale-while-revalidate background refresh.

type AuthMeResponse = { authenticated: boolean; user?: any } | null;

let userPromise: Promise<AuthMeResponse> | null = null;
let cachedUser: AuthMeResponse = null;

let settingsPromise: Promise<any | null> | null = null;
let cachedSettings: any = null;

// Generic memory cache for fast navigation (Invoices, Shipments, Overview)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const apiCache = new Map<string, CacheEntry<any>>();
const inFlightRequests = new Map<string, Promise<any>>();

// The stored user only exists in the browser, so reading it while React hydrates makes the
// client render differ from the server HTML (React error #418). Until the app has hydrated
// (see markClientHydrated) this returns null on the client, exactly like the server does.
let clientHydrated = typeof window === 'undefined';
export function markClientHydrated() {
  clientHydrated = true;
}

function cleanRoleName(_role?: string, name?: string): string {
  return name || 'User';
}

export function getCurrentUserCachedSync(): AuthMeResponse {
  if (!clientHydrated) return null;
  if (cachedUser) {
    if (cachedUser.user) {
      cachedUser.user.name = cleanRoleName(cachedUser.user.role, cachedUser.user.name);
    }
    return cachedUser;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('erp_current_user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.id) {
          parsed.name = cleanRoleName(parsed.role, parsed.name);
          cachedUser = { authenticated: true, user: parsed };
          return cachedUser;
        }
      }
    } catch {}
  }
  return null;
}

export function fetchCurrentUserCached(force = false): Promise<AuthMeResponse> {
  if (!force && cachedUser) {
    if (cachedUser.user) {
      cachedUser.user.name = cleanRoleName(cachedUser.user.role, cachedUser.user.name);
    }
    return Promise.resolve(cachedUser);
  }

  if (force || !userPromise) {
    userPromise = fetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) {
          cachedUser = null;
          return null;
        }
        const data = await res.json();
        if (data?.user) {
          data.user.name = cleanRoleName(data.user.role, data.user.name);
        }
        cachedUser = data;
        if (typeof window !== 'undefined' && data?.user) {
          try {
            localStorage.setItem('erp_current_user', JSON.stringify(data.user));
          } catch {}
        }
        return data;
      })
      .catch(() => {
        return cachedUser;
      })
      .finally(() => {
        userPromise = null;
      });
  }
  return userPromise;
}

export function invalidateCurrentUser() {
  userPromise = null;
  cachedUser = null;
  // Never let the next user on this tab see the previous user's cached API data.
  apiCache.clear();
  inFlightRequests.clear();
  cachedSettings = null;
  settingsPromise = null;
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('erp_current_user');
    } catch {}
  }
}

export function fetchSettingsCached(force = false): Promise<any | null> {
  if (!force && cachedSettings) {
    return Promise.resolve(cachedSettings);
  }

  if (force || !settingsPromise) {
    settingsPromise = fetch('/api/settings')
      .then(async (res) => {
        if (!res.ok) return cachedSettings;
        const data = await res.json();
        cachedSettings = data;
        return data;
      })
      .catch(() => cachedSettings)
      .finally(() => {
        settingsPromise = null;
      });
  }
  return settingsPromise;
}

export function invalidateSettings() {
  settingsPromise = null;
  cachedSettings = null;
}

/**
 * Fetch with memory-cache + request deduplication (Stale-While-Revalidate pattern)
 * Used to make navigation between Dashboard, Invoices, Shipments, and Depots instantaneous.
 */
export async function fetchWithCache<T>(
  url: string,
  options?: RequestInit,
  ttlMs = 15000
): Promise<T> {
  const method = options?.method || 'GET';
  if (method !== 'GET') {
    return (await fetch(url, options)).json();
  }

  const now = Date.now();
  const cached = apiCache.get(url);

  // If cache is fresh, return immediately (0ms instant page navigation)
  if (cached && now - cached.timestamp < ttlMs) {
    return cached.data as T;
  }

  // Deduplicate concurrent in-flight requests to the exact same URL
  let inFlight = inFlightRequests.get(url);
  if (!inFlight) {
    inFlight = fetch(url, options)
      .then(async (res) => {
        if (!res.ok) {
          if (cached) return cached.data; // fallback to stale on network error
          throw new Error(`HTTP error ${res.status}`);
        }
        const data = await res.json();
        apiCache.set(url, { data, timestamp: Date.now() });
        return data;
      })
      .catch((err) => {
        if (cached) return cached.data;
        throw err;
      })
      .finally(() => {
        inFlightRequests.delete(url);
      });

    inFlightRequests.set(url, inFlight);
  }

  // If we have stale data and request is in flight, return stale immediately while background refreshes
  if (cached) {
    return cached.data as T;
  }

  return inFlight as Promise<T>;
}

export function invalidateApiCache(urlPrefix?: string) {
  if (!urlPrefix) {
    apiCache.clear();
    return;
  }
  apiCache.forEach((_, key) => {
    if (key.startsWith(urlPrefix)) {
      apiCache.delete(key);
    }
  });
}
