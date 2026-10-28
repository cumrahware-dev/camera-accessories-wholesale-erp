/**
 * Signed links for the customer-facing document portal (/view/invoice/[token]).
 * The token is `<documentId>.<signature>`; the signature is an HMAC of the id, so a link cannot be guessed or
 * edited to open someone else's invoice, and no login is needed. Server-side only (uses the auth secret).
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { appLink } from '@/lib/app-url';

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

/** Signed customer link. Built only from the configured public address (lib/app-url); throws AppUrlError when it is missing in production. */
export function portalUrl(kind: 'TAX_INVOICE', id: string): string {
  return appLink(`/view/invoice/${makeShareToken(kind, id)}`);
}
