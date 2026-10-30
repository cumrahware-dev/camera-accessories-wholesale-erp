/**
 * Company profile used on every customer document, read from the database (Settings -> Company & Business Details).
 *
 * A document that has been ISSUED carries a snapshot of the company and bank details as they were at that moment
 * (companySnapshot), so editing Settings later never rewrites history. Drafts always use the live settings.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCompanySettingsCached } from '@/lib/settings-cache';

type Db = Prisma.TransactionClient | typeof prisma;

export interface CompanyView {
  companyName: string; tradingName: string; logoUrl: string; companyAddress: string;
  phone: string; mobile: string; email: string; website: string;
  vatGstNumber: string; taxRegistrationNumber: string; corporateTaxNumber: string; tradeLicenceNumber: string; dunsNumber: string;
}
export interface BankView {
  id: string; label: string; bankName: string; branch: string; accountName: string; accountNumber: string; iban: string; swiftBic: string;
  routingCode: string; currency: string; bankAddress: string; paymentInstructions: string; otherInfo: string; isDefault: boolean;
}
export interface CompanyProfile { company: CompanyView; bankAccounts: BankView[]; capturedAt?: string; fromSnapshot: boolean }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function companyView(s: any): CompanyView {
  return {
    companyName: str(s?.companyName), tradingName: str(s?.tradingName), logoUrl: str(s?.logoUrl), companyAddress: str(s?.companyAddress),
    phone: str(s?.phone), mobile: str(s?.mobile), email: str(s?.email), website: str(s?.website),
    vatGstNumber: str(s?.vatGstNumber), taxRegistrationNumber: str(s?.taxRegistrationNumber), corporateTaxNumber: str(s?.corporateTaxNumber),
    tradeLicenceNumber: str(s?.tradeLicenceNumber), dunsNumber: str(s?.dunsNumber),
  };
}
export const bankView = (b: any): BankView => ({
  id: b.id, label: str(b.label), bankName: str(b.bankName), branch: str(b.branch), accountName: str(b.accountName), accountNumber: str(b.accountNumber),
  iban: str(b.iban), swiftBic: str(b.swiftBic), routingCode: str(b.routingCode), currency: str(b.currency), bankAddress: str(b.bankAddress),
  paymentInstructions: str(b.paymentInstructions), otherInfo: str(b.otherInfo), isDefault: !!b.isDefault,
});

export async function activeBankAccounts(db: Db = prisma): Promise<BankView[]> {
  const rows = await db.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }).catch(() => []);
  return rows.map(bankView);
}

/**
 * Validates a bank account chosen for a document of a given currency: it must exist, be active, and be in that
 * currency. Backend-enforced (never trusts the client picked a valid id) — used by Proforma create/update.
 * Returns the matching BankView row, or an error message to send back as a 400.
 */
export async function validateSelectedBankAccount(db: Db, bankAccountId: string, currency: string): Promise<{ account: BankView } | { error: string }> {
  const row = await db.bankAccount.findUnique({ where: { id: bankAccountId } });
  if (!row) return { error: 'The selected bank account no longer exists. Choose another one.' };
  if (!row.isActive) return { error: 'The selected bank account is inactive. Choose an active account.' };
  const docCurrency = (currency || '').toUpperCase();
  if (row.currency && row.currency.toUpperCase() !== docCurrency) {
    return { error: `${row.label || row.bankName} is a ${row.currency} account and cannot be used for a ${docCurrency} document.` };
  }
  return { account: bankView(row) };
}

/** Current company details and the ACTIVE bank accounts (display; settings may be up to a minute old on another instance). */
export async function liveProfile(): Promise<CompanyProfile> {
  const [s, banks] = await Promise.all([getCompanySettingsCached(), activeBankAccounts()]);
  return { company: companyView(s), bankAccounts: banks, fromSnapshot: false };
}

/** The profile a document must print: its frozen snapshot if it has been issued, otherwise the live settings. */
export function profileFor(doc: { companySnapshot?: unknown } | null | undefined, live: CompanyProfile): CompanyProfile {
  const snap = doc?.companySnapshot as any;
  if (snap && typeof snap === 'object' && snap.company) {
    return { company: { ...companyView({}), ...companyView(snap.company) }, bankAccounts: Array.isArray(snap.bankAccounts) ? snap.bankAccounts.map(bankView) : [], capturedAt: snap.capturedAt, fromSnapshot: true };
  }
  return live;
}

/**
 * Which bank accounts a document prints. A document that has a manually SELECTED account (currently only
 * Proforma.bankAccountId) prints that one account alone, never the full currency-matching list.
 * For Proformas without an account selected (and not restored from a historical snapshot), it returns empty
 * to prevent automatically displaying every registered bank account.
 * Anything else (historical snapshots, tax/service invoices) keeps the standard behaviour: accounts matching
 * currency, else the default. Never an inactive one.
 */
export function banksForDocument(
  accounts: BankView[],
  currency?: string | null,
  selectedBankAccountId?: string | null,
  isProforma?: boolean,
  fromSnapshot?: boolean
): BankView[] {
  if (!accounts.length) return [];
  if (selectedBankAccountId) {
    const selected = accounts.find((a) => a.id === selectedBankAccountId);
    if (selected) return [selected];
    if (isProforma) return [];
  }

  // If this is a proforma and not restored from a historical snapshot, it requires a manual selection.
  // Never automatically display every registered bank account for a proforma.
  if (isProforma && !fromSnapshot) {
    return [];
  }

  const c = (currency || '').toUpperCase();
  const match = c ? accounts.filter((a) => a.currency.toUpperCase() === c) : [];
  if (match.length) return match;
  const def = accounts.find((a) => a.isDefault) || accounts[0];
  // accounts with no currency set are usable for any currency
  const generic = accounts.filter((a) => !a.currency);
  return generic.length ? generic : [def];
}

/**
 * Snapshot taken from the database (authoritative, never the cache) at the moment a document is issued.
 * `onlyBankAccountId`, when given, freezes just that one account (a manually selected one) instead of every
 * active account — used for Proforma, which prints one chosen account, not every account in its currency.
 */
export async function buildSnapshot(db: Db = prisma, onlyBankAccountId?: string | null): Promise<Prisma.InputJsonValue> {
  const s = await db.companySettings.findUnique({ where: { id: 'global-settings' } });
  let banks: BankView[];
  if (onlyBankAccountId) {
    const acc = await db.bankAccount.findUnique({ where: { id: onlyBankAccountId } });
    banks = acc ? [bankView(acc)] : [];
  } else {
    banks = await activeBankAccounts(db);
  }
  return { capturedAt: new Date().toISOString(), company: companyView(s), bankAccounts: banks } as unknown as Prisma.InputJsonValue;
}

type SnapModel = 'proforma' | 'taxInvoice' | 'serviceInvoice';
/** Freezes company/bank details on a document the first time it is issued. Later calls leave the existing snapshot alone. */
export async function stampSnapshot(db: Db, model: SnapModel, id: string, onlyBankAccountId?: string | null): Promise<void> {
  const delegate: any = (db as any)[model];
  const cur = await delegate.findUnique({
    where: { id },
    select: { companySnapshot: true, ...(model === 'proforma' ? { bankAccountId: true } : {}) },
  });
  if (!cur || cur.companySnapshot) return;
  const bankId = onlyBankAccountId !== undefined ? onlyBankAccountId : cur.bankAccountId;
  await delegate.update({ where: { id }, data: { companySnapshot: await buildSnapshot(db, bankId) } });
}

export interface AddressParts { office?: string; building?: string; street?: string; area?: string; poBox?: string; city?: string; country?: string }
/** The printed address, one line per row, from its parts. */
export function composeAddress(p: AddressParts): string {
  const t = (v?: string) => (v || '').trim();
  const lines = [
    ...t(p.office).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    t(p.building),
    [t(p.street), t(p.area)].filter(Boolean).join(' '),
    t(p.poBox) ? (/^p\.?\s*o\.?\s*box/i.test(t(p.poBox)) ? t(p.poBox) : `P. O. Box ${t(p.poBox)}`) : '',
    [t(p.city), t(p.country)].filter(Boolean).join(' - '),
  ];
  return lines.filter(Boolean).join('\n');
}

/** Number of documents (issued snapshots or active proformas) that reference this bank account. */
export async function bankAccountUsage(id: string): Promise<number> {
  const like = `%"id": "${id.replace(/[%_\\"]/g, '')}"%`;
  const [a, b, c, pfRefs] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TaxInvoice" WHERE "companySnapshot"::text LIKE ${like}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Proforma" WHERE "companySnapshot"::text LIKE ${like}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "ServiceInvoice" WHERE "companySnapshot"::text LIKE ${like}`,
    prisma.proforma.count({ where: { bankAccountId: id } }).catch(() => 0),
  ]);
  return Number(a[0]?.n ?? 0) + Number(b[0]?.n ?? 0) + Number(c[0]?.n ?? 0) + Number(pfRefs);
}

/** What a screen needs to print this document: its company block and the bank accounts that belong on it. */
export async function companyProfileFor(doc: any): Promise<{ company: CompanyView; bankAccounts: BankView[]; fromSnapshot: boolean; capturedAt?: string }> {
  const p = profileFor(doc, await liveProfile());
  const isProforma = Boolean(doc?.proformaNumber || ('bankAccountId' in (doc || {})));
  return { company: p.company, bankAccounts: banksForDocument(p.bankAccounts, doc?.currency, doc?.bankAccountId, isProforma, p.fromSnapshot), fromSnapshot: p.fromSnapshot, capturedAt: p.capturedAt };
}

/** The document without its raw snapshot, plus the profile to print it with. */
export async function withCompanyProfile<T extends Record<string, any>>(doc: T): Promise<Omit<T, 'companySnapshot'> & { companyProfile: Awaited<ReturnType<typeof companyProfileFor>> }> {
  const { companySnapshot: _s, ...rest } = doc as any;
  return { ...rest, companyProfile: await companyProfileFor(doc) };
}
