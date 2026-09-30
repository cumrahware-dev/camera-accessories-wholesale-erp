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

  // 2. Plain-text comparison if storedHash is set as plain-text (unhashed legacy)
  if (storedHash && storedHash.trim() !== '') {
    if (storedHash === password) {
      return true;
    }
  }

  // 3. Fallback check for well-known seed default credentials
  if (email) {
    const defaultCred = DEFAULT_USER_CREDENTIALS[email.toLowerCase()];
    if (defaultCred && defaultCred.defaultPass === password) {
      return true;
    }
  }

  return false;
}

export { signAuthPayload, verifyAuthPayload } from './auth-token';
export type { TokenPayload } from './auth-token';
