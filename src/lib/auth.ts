import crypto from 'crypto';

/**
 * Password hashing (PBKDF2-SHA512).
 *
 *  - New hashes: `pbkdf2$<iterations>$<salt>$<hash>` with a high work factor.
 *  - Legacy hashes (`<salt>:<hash>`, 1,000 iterations) still verify so existing accounts keep working, and are
 *    upgraded to the new format the next time their owner signs in (see needsRehash).
 *
 * There are no built-in, default or fallback credentials: an account with no stored hash cannot sign in with a password.
 */
const ITERATIONS = 210_000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha512').toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!password || !storedHash) return false;

  if (storedHash.startsWith('pbkdf2$')) {
    const [, iter, salt, hash] = storedHash.split('$');
    const n = Number(iter);
    if (!n || !salt || !hash) return false;
    return safeEqualHex(crypto.pbkdf2Sync(password, salt, n, 64, 'sha512').toString('hex'), hash);
  }

  // legacy `salt:hash` (1,000 iterations)
  if (storedHash.includes(':')) {
    const [salt, original] = storedHash.split(':');
    if (!salt || !original) return false;
    return safeEqualHex(crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex'), original);
  }

  return false;
}

export function needsRehash(storedHash?: string | null): boolean {
  return !!storedHash && !storedHash.startsWith('pbkdf2$');
}

/** Random one-time password for new accounts / resets. Shown once to the administrator, never stored in plain text. */
export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*?';
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(upper), pick(lower), pick(lower), pick(lower), pick(lower), pick(lower), pick(digits), pick(digits), pick(digits), pick(symbols)];
  const all = upper + lower + digits;
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers.';
  return null;
}

export { signAuthPayload, verifyAuthPayload } from './auth-token';
export type { TokenPayload } from './auth-token';
