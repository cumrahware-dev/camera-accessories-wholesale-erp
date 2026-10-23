/**
 * Quantities (stock and document lines) are NUMERIC(18,3): up to three decimals, e.g. 54.620 Mt.
 * Prisma returns plain numbers for them (see lib/prisma.ts); this module is the one place that rounds, validates and formats them.
 * Browser-safe (no server imports).
 */
export const QTY_DECIMALS = 3;
const F = 10 ** QTY_DECIMALS;

/** Number from a value Prisma typed as Decimal (it is already a number at runtime). */
export const qtyNum = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Rounds to the 3 decimals the database stores: removes float noise such as 100.27000000000001. */
export const roundQty = (v: unknown): number => Math.round((qtyNum(v) + Number.EPSILON * Math.sign(qtyNum(v))) * F) / F;
/** Exact sum of quantities. */
export const addQty = (...vs: unknown[]): number => roundQty(vs.reduce<number>((s, v) => s + Math.round(qtyNum(v) * F), 0) / F);
export const subQty = (a: unknown, b: unknown): number => roundQty((Math.round(qtyNum(a) * F) - Math.round(qtyNum(b) * F)) / F);
/** a >= b without float noise. */
export const qtyGte = (a: unknown, b: unknown): boolean => Math.round(qtyNum(a) * F) >= Math.round(qtyNum(b) * F);

/** Number of decimals actually present in a quantity (0..3+), ignoring trailing zeros. */
export function decimalsOf(v: unknown): number {
  const s = String(qtyNum(v));
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Validates a quantity typed or sent by a user. `maxDecimals` comes from the unit (Pcs 0, Mt 3 ...), never above 3.
 * Returns the normalised number or an error message.
 */
export function parseQty(raw: unknown, opts: { maxDecimals?: number; allowZero?: boolean } = {}): { value: number; error?: undefined } | { value?: undefined; error: string } {
  const max = Math.min(QTY_DECIMALS, opts.maxDecimals ?? QTY_DECIMALS);
  const text = typeof raw === 'string' ? raw.trim().replace(/,/g, '') : raw;
  if (text === '' || text === null || text === undefined) return { error: 'Enter a quantity.' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: 'Quantity must be a number.' };
  if (n < 0 || (n === 0 && !opts.allowZero)) return { error: 'Quantity must be greater than 0.' };
  if (n >= 1e12) return { error: 'Quantity is too large.' };
  const s = typeof text === 'string' ? text : String(n);
  const frac = /^\d*\.(\d+)$/.exec(s)?.[1]?.replace(/0+$/, '') ?? '';
  if (frac.length > max) return { error: max === 0 ? 'This unit is sold in whole numbers.' : `At most ${max} decimal place${max === 1 ? '' : 's'} are allowed for this unit.` };
  return { value: roundQty(n) };
}

/** "54.620", "12", "0.500": exactly `decimals` places when given, otherwise as many as the value needs (min 0). */
export function formatQty(v: unknown, decimals?: number): string {
  const n = qtyNum(v);
  const d = decimals ?? decimalsOf(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
}
/** Quantity with its unit: "54.620 Mt", "12 Pcs". */
export const formatQtyUnit = (v: unknown, unit?: string | null, decimals?: number): string => `${formatQty(v, decimals)}${unit ? ' ' + unit : ''}`;

/** Opening / bulk stock figure from a form or file: non-negative, up to 3 decimals, junk becomes 0. */
export const stockQty = (v: unknown): number => Math.max(0, roundQty(parseFloat(String(v ?? '').replace(/,/g, '')) || 0));

export interface UnitInfo { code: string; name?: string; decimals: number }
/** Decimals a unit prints with (Mt 3 -> "54.620"). Unknown unit: the quantity's own decimals. */
export function unitDecimalsOf(unit: string | null | undefined, units: UnitInfo[] | undefined, value?: unknown): number {
  const u = unit ? units?.find((x) => x.code.toLowerCase() === String(unit).toLowerCase()) : undefined;
  return Math.max(u ? u.decimals : 0, decimalsOf(value));
}
/** "54.620 Mt" / "12 Pcs": decimals follow the unit so trailing zeros are kept. */
export const fmtQtyWithUnit = (v: unknown, unit: string | null | undefined, units?: UnitInfo[], withUnit = true): string =>
  `${formatQty(v, unitDecimalsOf(unit, units, v))}${withUnit && unit ? ' ' + unit : ''}`;
