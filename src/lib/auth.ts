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

  // Anything else (empty or non-PBKDF2 value) is rejected. Plain-text comparison and
  // well-known default passwords are only tolerated outside production, for local dev seeds.
  if (process.env.NODE_ENV !== 'production') {
    if (storedHash && storedHash.trim() !== '') return storedHash === password;
    if (email && DEFAULT_USER_CREDENTIALS[email.toLowerCase()]) {
      return password === DEFAULT_USER_CREDENTIALS[email.toLowerCase()].defaultPass;
    }
  }

  return false;
}

export { signAuthPayload, verifyAuthPayload } from './auth-token';
export type { TokenPayload } from './auth-token';
