/**
 * Pure SKU helpers (no server imports) shared by matching and tests.
 *
 * skuKey() is a LOOKUP key only: it removes case, whitespace and the separators OCR inserts or drops (hyphen, underscore,
 * dot, slash, dashes). Every other character ("+", "#", "(", ...) and every digit, including leading zeros, is kept.
 * The stored SKU is never rewritten with it.
 */

/** Characters ignored when comparing SKUs. MUST stay in step with SKU_KEY_SQL_CLASS below and the expression indexes. */
const SEPARATORS = /[\s_./‐‑‒–—―-]+/g;
/** Same set as a POSIX class for PostgreSQL: used in the expression indexes and the lookup queries. */
export const SKU_KEY_SQL_CLASS = '[[:space:]_./‐‑‒–—―-]';

export const skuKey = (s: string | null | undefined): string => String(s ?? '').normalize('NFKC').replace(SEPARATORS, '').toUpperCase();

/** Characters OCR commonly swaps for one another, and what each can really be. */
const CONFUSABLE: Record<string, string[]> = {
  O: ['0'], '0': ['O'],
  I: ['1', 'L'], '1': ['I', 'L'], L: ['1', 'I'],
  S: ['5'], '5': ['S'],
};

export interface SkuVariant { key: string; changes: string[] }

/**
 * Keys the printed SKU could really be if OCR confused look-alike characters (O/0, I/1/L, S/5): at most `maxChanges`
 * characters altered, nearest first. The key itself is not included. Capped so a long SKU cannot explode.
 */
export function confusionVariants(key: string, maxChanges = 2, cap = 60): SkuVariant[] {
  const positions: number[] = [];
  for (let i = 0; i < key.length; i++) if (CONFUSABLE[key[i]]) positions.push(i);
  const out: SkuVariant[] = [];
  const walk = (start: number, cur: string[], changes: string[]) => {
    if (changes.length) out.push({ key: cur.join(''), changes: [...changes] });
    if (changes.length >= maxChanges) return;
    for (let p = start; p < positions.length; p++) {
      const i = positions[p];
      for (const alt of CONFUSABLE[key[i]]) {
        const next = cur.slice(); next[i] = alt;
        walk(p + 1, next, [...changes, `${key[i]}→${alt} at ${i + 1}`]);
        if (out.length >= cap * 4) return;
      }
    }
  };
  walk(0, key.split(''), []);
  return out.sort((a, b) => a.changes.length - b.changes.length).slice(0, cap);
}

/** True when a printed value is plausibly a product code and not a page number, "N/A", a dash or a quantity word. */
export function looksLikeSku(s: string | null | undefined): boolean {
  const k = skuKey(s);
  if (k.length < 2 || k.length > 40) return false;
  if (/^(NA|N\/A|NIL|NONE|NULL|TBA|TBD)$/.test(k)) return false;
  return /[A-Z0-9]/.test(k);
}
