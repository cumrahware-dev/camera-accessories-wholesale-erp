/**
 * Browser-side money helpers for LIVE PREVIEW totals only (no Prisma runtime in client bundles).
 * Arithmetic is done in integer minor units; the server (lib/money.ts, decimal arithmetic) is authoritative.
 */
type Num = number | string | null | undefined;
const n = (v: Num) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const cents = (v: number) => Math.round(Number((v * 100).toPrecision(15)));
export const round2 = (v: number | C): number => cents(Number(v)) / 100;

/** Chainable minor-unit value: dec(a).times(b).minus(c).plus(d) -> number via valueOf()/toNumber(). */
class C {
  constructor(public v: number) {}
  times(x: Num) { return new C(this.v * n(x)); }
  minus(x: Num) { return new C(this.v - n(x)); }
  plus(x: Num) { return new C(this.v + n(x)); }
  toNumber() { return this.v; }
  valueOf() { return this.v; }
}
export const dec = (v: Num): C => new C(n(v));
export const taxOn = (base: number, ratePct: Num): number => round2((cents(base) * n(ratePct)) / 100 / 100);
