/**
 * The ONE place that decides the public address of the ERP for links that leave the app (emails, customer portal links).
 *
 *   APP_BASE_URL=https://erp.aribglobal.com      (production; server-side only)
 * Older names are still read so an existing deployment keeps working: APP_URL, NEXT_PUBLIC_APP_URL.
 *
 * Never derived from the incoming request (Host / Origin / Referer can be forged or be an internal address).
 * In production a missing, non-https or localhost value is a configuration error: links are NOT produced (the caller
 * reports it) instead of mailing customers a localhost link. In development it falls back to http://localhost:PORT.
 */
export class AppUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'AppUrlError'; }
}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)$/i;
let warned = false;

function configured(): { value: string; name: string } | null {
  for (const name of ['APP_BASE_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL']) {
    const v = (process.env[name] || '').trim();
    if (v) return { value: v, name };
  }
  return null;
}

/** e.g. "https://erp.aribglobal.com" (no trailing slash). Throws AppUrlError in production when it is not set correctly. */
export function appBaseUrl(): string {
  const isProd = process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'development';
  const c = configured();
  if (!c) {
    if (isProd) {
      const msg = 'APP_BASE_URL is not set. Set APP_BASE_URL=https://erp.aribglobal.com in the production environment; email links are not generated until it is.';
      if (!warned) { console.error(`[config] ${msg}`); warned = true; }
      throw new AppUrlError(msg);
    }
    return `http://localhost:${process.env.PORT || 3000}`;
  }
  let u: URL;
  try { u = new URL(c.value); } catch { throw new AppUrlError(`${c.name} is not a valid URL.`); }
  if (isProd) {
    if (u.protocol !== 'https:') throw new AppUrlError(`${c.name} must use https in production.`);
    if (LOCAL.test(u.hostname)) throw new AppUrlError(`${c.name} points to ${u.hostname}; it must be the public address (https://erp.aribglobal.com) in production.`);
  }
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/** Absolute link to a page of the ERP: appLink('/quote/abc') -> https://erp.aribglobal.com/quote/abc */
export function appLink(path: string): string {
  return `${appBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Same as appLink, but undefined instead of throwing (for optional links shown inside the app). */
export function appLinkOrUndefined(path: string): string | undefined {
  try { return appLink(path); } catch { return undefined; }
}
