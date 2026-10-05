/**
 * Central tax configuration (Settings -> Tax rates). Nothing in the application assumes a tax rate:
 * the default comes from the TaxRate table, and when none is configured the answer is 0%.
 *
 * - Products either FOLLOW the default tax (useDefaultTax = true) or carry a deliberate custom rate.
 * - A document line stores the rate and amount used when it was created; changing the configuration never rewrites them.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { cleanText } from '@/lib/documents/terms';

type Db = Prisma.TransactionClient | typeof prisma;

export interface DefaultTax { id: string | null; name: string; rate: number }
export const NO_TAX_CONFIGURED: DefaultTax = { id: null, name: 'No tax configured', rate: 0 };

export const validRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

/** The default tax that is in force at `now`: active, flagged default, effective already; the latest effective date wins. */
export function pickDefault<T extends { isActive: boolean; isDefault: boolean; effectiveFrom: Date; id: string; name: string; rate: number }>(rows: T[], now = new Date()): DefaultTax {
  const hit = rows
    .filter((r) => r.isActive && r.isDefault && r.effectiveFrom.getTime() <= now.getTime())
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  return hit ? { id: hit.id, name: hit.name, rate: hit.rate } : NO_TAX_CONFIGURED;
}

export async function getDefaultTax(db: Db = prisma): Promise<DefaultTax> {
  const rows = await db.taxRate.findMany({ where: { isActive: true, isDefault: true } }).catch(() => []);
  return pickDefault(rows);
}

/** Rate to use for a product on a NEW document. */
export const effectiveProductRate = (p: { taxRate?: number | null; useDefaultTax?: boolean | null } | null | undefined, def: DefaultTax) =>
  p && p.useDefaultTax === false ? Number(p.taxRate ?? def.rate) : def.rate;

/**
 * Brings the stored taxRate of every product that follows the default in line with the current default.
 * Idempotent and cheap; also called lazily so a scheduled (future-dated) change takes effect on its date.
 * Returns how many products changed. Documents are never touched.
 */
export async function syncCatalogueTax(db: Db = prisma): Promise<number> {
  const def = await getDefaultTax(db);
  const r = await db.product.updateMany({ where: { useDefaultTax: true, NOT: { taxRate: def.rate } }, data: { taxRate: def.rate } });
  return r.count;
}

/**
 * Tax fields of a product being created/edited. A product follows the default unless it is explicitly set to a custom rate.
 *  - useDefaultTax === true              -> follows the default
 *  - useDefaultTax === false             -> uses the given taxRate (validated 0..100)
 *  - useDefaultTax missing, taxRate given -> custom only if it differs from the default, otherwise follows it
 *  - nothing given                        -> follows the default
 */
export function resolveProductTax(input: { taxRate?: unknown; useDefaultTax?: unknown }, def: DefaultTax): { taxRate: number; useDefaultTax: boolean } | { error: string } {
  const given = input.taxRate === undefined || input.taxRate === null || input.taxRate === '' ? undefined : Number(input.taxRate);
  if (given !== undefined && !validRate(given)) return { error: 'Tax rate must be a number between 0 and 100.' };
  if (input.useDefaultTax === true || (input.useDefaultTax === undefined && (given === undefined || given === def.rate))) return { taxRate: def.rate, useDefaultTax: true };
  if (given === undefined) return { error: 'Enter the custom tax rate, or choose "use the default tax".' };
  return { taxRate: given, useDefaultTax: false };
}

/** Parses and validates a tax-rate payload (create: all fields; update: only those present). */
export function parseTaxInput(body: any, creating: boolean): { error?: string; data: { name?: string; rate?: number; description?: string; isActive?: boolean; isDefault?: boolean; effectiveFrom?: Date } } {
  const data: any = {};
  if (creating || body?.name !== undefined) {
    const name = cleanText(body?.name, 60);
    if (!name) return { error: 'Tax name is required.', data };
    data.name = name;
  }
  if (creating || body?.rate !== undefined) {
    const rate = Number(body?.rate);
    if (body?.rate === '' || body?.rate === null || !validRate(rate)) return { error: 'Tax rate must be a number between 0 and 100.', data };
    data.rate = rate;
  }
  if (body?.description !== undefined) data.description = cleanText(body.description, 200);
  if (body?.isActive !== undefined) data.isActive = !!body.isActive;
  if (body?.isDefault !== undefined) data.isDefault = !!body.isDefault;
  if (body?.effectiveFrom !== undefined && body.effectiveFrom !== '') {
    const d = new Date(body.effectiveFrom);
    if (isNaN(d.getTime())) return { error: 'Effective date is not a valid date.', data };
    data.effectiveFrom = d;
  }
  return { data };
}

