/**
 * ERP access codes.
 *
 *  - Generated on the server from cryptographically secure random sources.
 *    Format `ERP-XXXX-XXXX-XXXX` (12 characters from base-31 alphabet).
 *  - Only secure hashes are stored. Plaintext codes are returned once at creation / regeneration.
 */
import 'server-only';
import { createHmac, randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const GROUPS = 3;
const GROUP_LEN = 4;

function pepper(): string {
  const key = process.env.ACCESS_CODE_PEPPER || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ACCESS_CODE_PEPPER (or NEXTAUTH_SECRET) must be configured to use access codes.');
  }
  return process.env.DATABASE_URL || 'dev-only-access-code-pepper';
}

export function generateErpAccessCode(): string {
  const parts: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let part = '';
    for (let i = 0; i < GROUP_LEN; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(part);
  }
  return `ERP-${parts.join('-')}`;
}

export function normalizeErpAccessCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  let v = input.toUpperCase().replace(/[\s-]+/g, '');
  if (v.startsWith('ERP')) v = v.slice(3);
  if (v.length !== GROUPS * GROUP_LEN) return null;
  for (const ch of v) if (!ALPHABET.includes(ch)) return null;
  return v;
}

export function hashErpAccessCode(input: string): string | null {
  const canonical = normalizeErpAccessCode(input);
  return canonical ? createHmac('sha256', pepper()).update(`erp-access:${canonical}`).digest('hex') : null;
}
