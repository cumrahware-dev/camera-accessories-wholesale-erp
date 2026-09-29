/** Shared input validators for API routes. */
export function isValidEmail(v: unknown): boolean {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v.trim());
}

/** Optional phone: 7-15 digits, allowing + ( ) - . and spaces. */
export function isValidPhone(v: unknown): boolean {
  if (v === undefined || v === null || String(v).trim() === '') return true;
  const s = String(v).trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

/** Returns an error message if any given price/amount is negative or not a number. */
export function checkNonNegative(fields: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return `${k} must be a non-negative number`;
  }
  return null;
}
