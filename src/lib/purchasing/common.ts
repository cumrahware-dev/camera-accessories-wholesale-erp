import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type Tx = Prisma.TransactionClient;
export interface Actor { id: string; name: string; role: string }

export class PurchasingError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const refKey = (s: string) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Gap-free, race-safe document numbers (row-level lock via upsert). */
export async function nextNumber(tx: Tx, key: string, prefix: string, width = 5): Promise<string> {
  const rows = await tx.$queryRaw<{ nextValue: number }[]>`
    INSERT INTO "DocumentSequence" ("key", "nextValue") VALUES (${key}, 2)
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1
    RETURNING "nextValue"`;
  const value = Number(rows[0].nextValue) - 1;
  return `${prefix}${String(value).padStart(width, '0')}`;
}

export interface JournalLineInput { headId: string; debit?: number; credit?: number; supplierId?: string | null; description?: string }

/**
 * Writes one balanced journal entry. (sourceType, sourceId) is unique, so a document can never be posted twice.
 * The ledger tables are append-only (database triggers).
 */
export async function postJournal(
  tx: Tx,
  e: { sourceType: string; sourceId: string; sourceRef: string; date: Date; narration: string; lines: JournalLineInput[]; actor: Actor }
) {
  const lines = e.lines.filter((l) => r2(l.debit || 0) > 0 || r2(l.credit || 0) > 0);
  const debit = r2(lines.reduce((s, l) => s + r2(l.debit || 0), 0));
  const credit = r2(lines.reduce((s, l) => s + r2(l.credit || 0), 0));
  if (lines.length < 2 || debit !== credit || debit <= 0) {
    throw new PurchasingError(500, `Journal for ${e.sourceRef} is not balanced (Dr ${debit} / Cr ${credit}).`);
  }
  const heads = await tx.accountingHead.findMany({ where: { id: { in: lines.map((l) => l.headId) } } });
  const headMap = new Map(heads.map((h) => [h.id, h]));
  for (const l of lines) {
    const h = headMap.get(l.headId);
    if (!h || !h.isActive) throw new PurchasingError(400, 'An accounting head used by this posting is missing or inactive.');
  }
  const entryNumber = await nextNumber(tx, 'JOURNAL', 'JE-', 6);
  return tx.journalEntry.create({
    data: {
      entryNumber, entryDate: e.date, sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, narration: e.narration,
      totalDebit: debit, totalCredit: credit, createdById: e.actor.id, createdByName: e.actor.name,
      lines: {
        create: lines.map((l) => {
          const h = headMap.get(l.headId)!;
          return { accountingHeadId: h.id, accountCode: h.code, accountName: h.name, debit: r2(l.debit || 0), credit: r2(l.credit || 0), supplierId: l.supplierId ?? null, description: l.description || '' };
        }),
      },
    },
    include: { lines: true },
  });
}

export { writeAudit } from '@/lib/audit';

export function parseDate(v: unknown, field: string): Date {
  const s = String(v ?? '').trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s);
  if (!s || isNaN(d.getTime())) throw new PurchasingError(400, `${field} is not a valid date.`);
  return d;
}

export async function companyCurrency(): Promise<string> {
  try {
    const s = await prisma.companySettings.findUnique({ where: { id: 'global-settings' }, select: { currency: true } });
    return s?.currency || 'USD';
  } catch {
    return 'USD';
  }
}

/** The default chart of accounts the purchasing module posts to (identical to what migration 20261003090000 seeds). */
export const DEFAULT_HEADS = [
  { id: 'acc-1300', code: '1300', name: 'Inventory', type: 'ASSET', description: 'Stock on hand at purchase cost', usage: 'INVENTORY' },
  { id: 'acc-1410', code: '1410', name: 'Input VAT Recoverable', type: 'ASSET', description: 'Tax paid on supplier invoices', usage: 'INPUT_TAX' },
  { id: 'acc-1250', code: '1250', name: 'Supplier Claims Receivable', type: 'ASSET', description: 'Amounts suppliers owe us (e.g. support on paid invoices)', usage: 'PRICE_SUPPORT_SETTLEMENT' },
  { id: 'acc-2100', code: '2100', name: 'Accounts Payable - Suppliers', type: 'LIABILITY', description: 'Amounts owed to suppliers', usage: 'ACCOUNTS_PAYABLE,PRICE_SUPPORT_SETTLEMENT' },
  { id: 'acc-4510', code: '4510', name: 'Supplier Price Support Received', type: 'INCOME', description: 'Post-purchase price support / rebates from suppliers', usage: 'PRICE_SUPPORT_CREDIT' },
  { id: 'acc-5120', code: '5120', name: 'Purchase Discounts & Rebates Received', type: 'EXPENSE', description: 'Contra purchase-cost account for supplier rebates', usage: 'PRICE_SUPPORT_CREDIT' },
] as const;

/**
 * The accounts are found by their CODE (the stable business key), not by a fixed id: a chart of accounts that was restored,
 * re-imported or edited can hold the same account under another id. Any default account that does not exist at all is
 * (re)created exactly as the migration seeds it; an existing one is never modified or re-activated. Returns code -> head.
 */
export async function ensureDefaultHeads(codes: string[] = DEFAULT_HEADS.map((h) => h.code)) {
  const want = DEFAULT_HEADS.filter((h) => codes.includes(h.code));
  let found = await prisma.accountingHead.findMany({ where: { code: { in: want.map((h) => h.code) } } });
  const missing = want.filter((h) => !found.some((f) => f.code === h.code));
  if (missing.length) {
    // the default id may be taken by an account that now carries another code: then let the database generate the id
    const idsTaken = new Set((await prisma.accountingHead.findMany({ where: { id: { in: missing.map((h) => h.id) } }, select: { id: true } })).map((x) => x.id));
    await prisma.accountingHead.createMany({ data: missing.map(({ id, ...h }) => ({ ...(idsTaken.has(id) ? {} : { id }), ...h, type: h.type as any, isSystem: true, isActive: true })), skipDuplicates: true });
    console.warn(`[purchasing] restored missing default accounting heads: ${missing.map((m) => m.code).join(', ')}`);
    found = await prisma.accountingHead.findMany({ where: { code: { in: want.map((h) => h.code) } } });
  }
  return new Map(found.map((h) => [h.code, h]));
}
