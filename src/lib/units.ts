import 'server-only';
import { prisma } from '@/lib/prisma';
import { QTY_DECIMALS, parseQty } from '@/lib/quantity';

export interface Unit { code: string; name: string; decimals: number }
/** Fallback if the UnitOfMeasure table cannot be read: only the unit every existing product has. */
const FALLBACK: Unit[] = [{ code: 'Pcs', name: 'Pieces', decimals: 0 }];

let cache: { at: number; list: Unit[] } | null = null;
const TTL = 30_000;

/** Active units of measure (configurable in the UnitOfMeasure table; Pcs 0 decimals, Mt/Kg/Tonnes 3, Meters/Sq.m 2 ...). */
export async function listUnits(fresh = false): Promise<Unit[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL) return cache.list;
  try {
    const rows = await prisma.unitOfMeasure.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    cache = { at: Date.now(), list: rows.length ? rows.map((r) => ({ code: r.code, name: r.name, decimals: Math.min(QTY_DECIMALS, r.decimals) })) : FALLBACK };
  } catch {
    cache = { at: Date.now(), list: FALLBACK };
  }
  return cache.list;
}
export const clearUnitCache = () => { cache = null; };

/** How many decimal places a quantity in this unit may have. An unknown/legacy unit is treated as whole pieces. */
export async function decimalsForUnit(code?: string | null): Promise<number> {
  if (!code) return 0;
  const u = (await listUnits()).find((x) => x.code.toLowerCase() === String(code).toLowerCase());
  return u ? u.decimals : 0;
}

/** Synchronous lookup for validating many lines: `const dp = await unitDecimals(); parseQty(q, { maxDecimals: dp(product.unit) })`. */
export async function unitDecimals(): Promise<(code?: string | null) => number> {
  const list = await listUnits();
  return (code) => (code ? list.find((x) => x.code.toLowerCase() === String(code).toLowerCase())?.decimals ?? 0 : 0);
}

/** Validates a line/stock quantity against its unit. Returns the number, or throws-able message via {error}. */
export async function checkQuantity(raw: unknown, unit?: string | null, opts: { allowZero?: boolean } = {}) {
  return parseQty(raw, { maxDecimals: await decimalsForUnit(unit), allowZero: opts.allowZero });
}

/** Normalises a unit code typed or sent by a client to the configured one ("mt" -> "Mt"); undefined when it is not a known unit. */
export async function resolveUnit(code: unknown): Promise<Unit | undefined> {
  const c = String(code ?? '').trim().toLowerCase();
  if (!c) return undefined;
  return (await listUnits()).find((u) => u.code.toLowerCase() === c);
}
