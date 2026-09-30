/** Pure name-normalisation helpers shared by classification and matching. */
const LEGAL = new Set(['llc', 'ltd', 'limited', 'pvt', 'private', 'fze', 'fzco', 'fz', 'inc', 'co', 'company', 'corp', 'corporation', 'gmbh', 'llp', 'plc', 'the', 'and', 'of', 'general', 'trading']);

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !LEGAL.has(t)).join(' ');
}
export function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(' ').filter(Boolean));
}
export const firstToken = (s: string): string | undefined => normalizeName(s).split(' ').filter(Boolean)[0];
export function similarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a), tb = tokens(b);
  const inter = Array.from(ta).filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}
