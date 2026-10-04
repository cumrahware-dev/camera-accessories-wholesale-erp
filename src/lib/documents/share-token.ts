/**
 * Signed links for the customer-facing document portal (/view/invoice/[token]).
 * The token is `<documentId>.<signature>`; the signature is an HMAC of the id, so a link cannot be guessed or
 * edited to open someone else's invoice, and no login is needed. Server-side only (uses the auth secret).
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET || process.env.DATABASE_URL || 'arib-erp-share-secret';
}

const sign = (kind: string, id: string) => createHmac('sha256', secret()).update(`${kind}:${id}`).digest('base64url').slice(0, 27);

export const makeShareToken = (kind: 'TAX_INVOICE', id: string) => `${id}.${sign(kind, id)}`;

/** Returns the document id when the token is genuine, otherwise null. */
export function readShareToken(kind: 'TAX_INVOICE', token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(kind, id));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function portalUrl(kind: 'TAX_INVOICE', id: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/view/invoice/${makeShareToken(kind, id)}`;
}
