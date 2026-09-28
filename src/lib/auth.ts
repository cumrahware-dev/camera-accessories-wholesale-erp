import crypto from 'crypto';

// Default initial credentials for seed accounts
export const DEFAULT_USER_CREDENTIALS: Record<string, { role: string; defaultPass: string }> = {
  'admin@aribglobal.com': { role: 'SUPER_ADMIN', defaultPass: 'Admin@Arib2026!' },
  'sarah.admin@lenscore.com': { role: 'SUPER_ADMIN', defaultPass: 'Admin@Arib2026!' },
  'marcus.vance@lenscore.com': { role: 'MANAGER', defaultPass: 'Manager@Growth2026!' },
  'priya.erp@lenscore.com': { role: 'ERP_USER', defaultPass: 'ErpUser@Growth2026!' },
  'depot@aribglobal.com': { role: 'DEPOT_USER', defaultPass: 'Depot@Arib2026!' },
  'tariq.dxb@lenscore.com': { role: 'DEPOT_USER', defaultPass: 'Depot@Arib2026!' },
};

/**
 * Hash password with salt using PBKDF2
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, storedHash?: string | null, email?: string): boolean {
  if (!password) return false;

  // 1. Authoritative PBKDF2 hash verification (salt:hash)
  if (storedHash && storedHash.includes(':')) {
    const [salt, originalHash] = storedHash.split(':');
    if (!salt || !originalHash) return false;
    const hashToVerify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hashToVerify === originalHash;
  }

  // 2. Direct string comparison if stored directly
  if (storedHash && storedHash.trim() !== '') {
    return storedHash === password;
  }

  // 3. Fallback for uninitialized seed accounts
  if ((!storedHash || storedHash.trim() === '') && email && DEFAULT_USER_CREDENTIALS[email.toLowerCase()]) {
    return password === DEFAULT_USER_CREDENTIALS[email.toLowerCase()].defaultPass;
  }

  return false;
}

/**
 * Depot Access Code helpers
 *
 * A depot user's access code is never stored in plaintext. `accessCodeHash`
 * holds a salted PBKDF2 hash (same format/verification as passwordHash, so
 * verifyPassword() covers it too) and `accessCodeLookupHash` holds an
 * unsalted SHA-256 digest of the normalized code, kept in a unique index so
 * the login endpoint can find the matching user without scanning every row
 * (the user isn't identified by email first, unlike password login).
 */
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 — avoids look-alike mistakes

export function normalizeAccessCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function generateAccessCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ACCESS_CODE_ALPHABET[bytes[i] % ACCESS_CODE_ALPHABET.length];
  }
  return code;
}

export function lookupHashForAccessCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeAccessCode(code)).digest('hex');
}

/** Returns the two values to persist for a new/rotated access code. */
export function hashAccessCode(code: string): { accessCodeHash: string; accessCodeLookupHash: string } {
  const normalized = normalizeAccessCode(code);
  return {
    accessCodeHash: hashPassword(normalized),
    accessCodeLookupHash: lookupHashForAccessCode(normalized),
  };
}

export function verifyAccessCode(code: string, storedHash?: string | null): boolean {
  if (!code || !storedHash) return false;
  return verifyPassword(normalizeAccessCode(code), storedHash);
}

export { signAuthPayload, verifyAuthPayload } from './auth-token';
export type { TokenPayload } from './auth-token';
