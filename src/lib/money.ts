/**
 * Decimal-safe money arithmetic. Floats are fine for storing amounts but not for adding them up
 * (0.1 + 0.2, 1.005 * 100): every OCR / purchase total goes through here instead.
 * Rounding is half-up to the currency's minor unit (2 places).
 */
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
export type Num = number | string | Prisma.Decimal;

export const dec = (v: Num | null | undefined): Prisma.Decimal => {
  const n = new D(v === null || v === undefined || v === '' ? 0 : (v as any));
  return n.isFinite() ? n : new D(0);
};
/** Rounds to 2 places (half-up) and returns a plain number for storage. */
export const round2 = (v: Num): number => dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber();
export const round4 = (v: Num): number => dec(v).toDecimalPlaces(4, D.ROUND_HALF_UP).toNumber();
export const sum2 = (xs: Num[]): number => round2(xs.reduce<Prisma.Decimal>((s, x) => s.plus(dec(x)), new D(0)));
/** qty x unit price - line discount, rounded once. */
export const lineNet = (qty: Num, unitPrice: Num, discount: Num = 0): number => round2(dec(qty).times(dec(unitPrice)).minus(dec(discount)));
/** tax on an amount at a percentage rate. */
export const taxOn = (base: Num, ratePct: Num): number => round2(dec(base).times(dec(ratePct)).div(100));
/** |a - b| <= tol, compared exactly. */
export const within = (a: Num, b: Num, tol: Num = 0.05): boolean => dec(a).minus(dec(b)).abs().lessThanOrEqualTo(dec(tol));
