/**
 * Depot access codes.
 *
 *  - Generated here, on the server, from a cryptographically secure random source (never derived from the depot
 *    name or code, never sequential). Format `DEP-XXXX-XXXX-XXXX`: 12 characters from a 31-letter alphabet
 *    without look-alike characters (about 59 bits).
 *  - Only a keyed hash (HMAC-SHA-256 with a server-side secret) is stored. The code itself exists in memory for the
 *    one response that shows it to the Super Admin, and nowhere else: not in the database, logs or audit trail.
 *  - A keyed hash cannot be reversed or brute-forced offline without the secret, and still allows a direct,
 *    unique-index lookup at sign-in.
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
    // Refuse to hash with a guessable key in production: set ACCESS_CODE_PEPPER or NEXTAUTH_SECRET.
    throw new Error('ACCESS_CODE_PEPPER (or NEXTAUTH_SECRET) must be configured to use depot access codes.');
  }
  return process.env.DATABASE_URL || 'dev-only-access-code-pepper';
}

export function generateAccessCode(): string {
  const parts: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let part = '';
    for (let i = 0; i < GROUP_LEN; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    parts.push(part);
  }
  return `DEP-${parts.join('-')}`;
}

/** Canonical form: upper case, separators and the DEP prefix removed. Returns null when it cannot be a valid code. */
export function normalizeAccessCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  let v = input.toUpperCase().replace(/[\s-]+/g, '');
  if (v.startsWith('DEP')) v = v.slice(3);
  if (v.length !== GROUPS * GROUP_LEN) return null;
  for (const ch of v) if (!ALPHABET.includes(ch)) return null;
  return v;
}

export function hashAccessCode(input: string): string | null {
  const canonical = normalizeAccessCode(input);
  return canonical ? createHmac('sha256', pepper()).update(`depot-access:${canonical}`).digest('hex') : null;
}
